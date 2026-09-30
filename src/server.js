require('dotenv').config();
const express=require('express');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const cookieParser=require('cookie-parser');
const helmet=require('helmet');
const multer=require('multer');
const {pool}=require('./db');
const {getPaymentProvider,hmac}=require('./payments');
const {sendMail,verifyMailConfig}=require('./mailer');
const limits=require('./rate-limit');

const app=express();
const PORT=process.env.PORT||10000;
app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false}));
app.use((req,res,next)=>{res.setHeader('Referrer-Policy','no-referrer');next()});
app.use('/api',limits.global);
// Webhook must read the exact raw request body for HMAC verification, so it is registered before JSON parsing.
app.post('/api/payments/webhook',express.raw({type:'application/json',limit:'256kb'}),async(req,res)=>{
  const providerName=process.env.PAYMENT_PROVIDER||'manual';
  if(providerName!=='http') return res.status(404).json({error:'Payment provider webhooks are disabled in manual mode'});
  try{
    const signature=req.get('x-cashcamp-signature')||req.get('x-signature');
    const secret=process.env.PAYMENT_WEBHOOK_SECRET||'';
    const expected=hmac(req.body,secret);
    const sig=String(signature||''); const valid=!!signature && sig.length===expected.length && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig));
    const payload=JSON.parse(req.body.toString('utf8'));
    const eventId=String(payload.event_id||payload.id||payload.reference||crypto.createHash('sha256').update(req.body).digest('hex'));
    const eventType=String(payload.event_type||payload.type||'payment.updated');
    const inserted=await pool.query('INSERT INTO payment_events(provider,event_id,event_type,payload,signature_valid) VALUES($1,$2,$3,$4,$5) ON CONFLICT(provider,event_id) DO NOTHING RETURNING id',[providerName,eventId,eventType,payload,!!valid]);
    if(!valid){await audit(null,'payment.webhook.invalid', 'payment_event',eventId,req,{eventType});return res.status(401).json({error:'Invalid webhook signature'})}
    if(!inserted.rowCount)return res.json({ok:true,duplicate:true});
    const reference=String(payload.reference||payload.merchant_reference||'');
    const providerRef=String(payload.provider_ref||payload.transaction_id||payload.transactionId||'')||null;
    const status=String(payload.status||'').toLowerCase();
    const amount=Number(payload.amount||0);
    if(!reference) throw new Error('Webhook reference missing');
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const d=await client.query('SELECT * FROM deposits WHERE transaction_ref=$1 FOR UPDATE',[reference]);
      if(!d.rowCount) throw new Error('Deposit not found');
      const dep=d.rows[0];
      if(amount && amount!==Number(dep.amount)) throw new Error('Webhook amount mismatch');
      if(providerRef) await client.query('UPDATE deposits SET provider_ref=COALESCE(provider_ref,$1) WHERE id=$2',[providerRef,dep.id]);
      if(['paid','successful','success','completed'].includes(status)){
        if(dep.status!=='approved') await approveDeposit(client,dep.id,'webhook',null);
      }else if(['failed','cancelled','canceled','expired'].includes(status)){
        await client.query("UPDATE deposits SET status='failed',updated_at=NOW() WHERE id=$1 AND status NOT IN ('approved')",[dep.id]);
      }else{
        await client.query("UPDATE deposits SET status='processing',updated_at=NOW() WHERE id=$1 AND status='created'",[dep.id]);
      }
      await client.query('UPDATE payment_events SET processed_at=NOW() WHERE id=$1',[inserted.rows[0].id]);
      await client.query('COMMIT');
    }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
    await audit(null,'payment.webhook.processed','deposit',reference,req,{status,providerRef});
    res.json({ok:true});
  }catch(e){console.error('Webhook error',e);res.status(400).json({error:'Webhook could not be processed'})}
});
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true,limit:'1mb'}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname,'../public')));

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp'].includes(file.mimetype))});
const sign=u=>jwt.sign({id:u.id,role:u.role},process.env.JWT_SECRET,{expiresIn:'7d'});
const token=()=>crypto.randomBytes(32).toString('hex');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const uaHash=req=>sha(String(req.get('user-agent')||''));
const ip=req=>req.ip;
function auth(req,res,next){try{const t=req.cookies.cc_token;if(!t)return res.status(401).json({error:'Login required'});req.user=jwt.verify(t,process.env.JWT_SECRET);next()}catch{res.status(401).json({error:'Session expired'})}}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Admin only'});next()}
function active(req,res,next){if(req.user.role==='admin')return next();return pool.query('SELECT status,email_verified_at FROM users WHERE id=$1',[req.user.id]).then(r=>{if(!r.rowCount)return res.status(401).json({error:'Account not found'});if(r.rows[0].status!=='active')return res.status(403).json({error:'Account must be active'});if(!r.rows[0].email_verified_at)return res.status(403).json({error:'Verify your email first'});next()}).catch(()=>res.status(500).json({error:'Account check failed'}))}
const settings=async()=>{const r=await pool.query('SELECT key,value FROM settings');return Object.fromEntries(r.rows.map(x=>[x.key,x.value]));};
async function audit(actor,action,targetType,targetId,req,metadata={}){try{await pool.query('INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,ip,user_agent_hash,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor,action,targetType,targetId,ip(req),uaHash(req),metadata])}catch(e){console.error('audit failed',e.message)}}
async function fraud(userId,eventType,severity,req,details={}){try{await pool.query('INSERT INTO fraud_events(user_id,event_type,severity,ip,user_agent_hash,details) VALUES($1,$2,$3,$4,$5,$6)',[userId,eventType,severity,ip(req),uaHash(req),details]);if(userId)await pool.query('UPDATE users SET risk_score=LEAST(100,risk_score+$1) WHERE id=$2',[severity,userId])}catch(e){console.error('fraud log failed',e.message)}}
async function ledger(client,userId,type,amount,reference,description){
  const r=await client.query('UPDATE users SET balance=balance+$1 WHERE id=$2 AND balance+$1>=0 RETURNING balance',[amount,userId]);
  if(!r.rowCount)throw new Error('Insufficient wallet balance');
  await client.query('INSERT INTO wallet_transactions(user_id,type,amount,balance_after,reference,description) VALUES($1,$2,$3,$4,$5,$6)',[userId,type,amount,r.rows[0].balance,reference,description]);
  return r.rows[0].balance;
}
async function issueAuthToken(userId,type,ttlMs){const raw=token();await pool.query("INSERT INTO auth_tokens(user_id,token_hash,token_type,expires_at) VALUES($1,$2,$3,NOW()+($4::bigint * interval '1 millisecond'))",[userId,sha(raw),type,ttlMs]);return raw}
async function approveDeposit(client,id,actor,req){
  const d=await client.query('SELECT * FROM deposits WHERE id=$1 FOR UPDATE',[id]);
  if(!d.rowCount)throw new Error('Deposit not found');
  const dep=d.rows[0];
  if(dep.status==='approved')return;
  if(!['pending','processing','created'].includes(dep.status))throw new Error('Deposit is not payable');
  await client.query("UPDATE deposits SET status='approved',reviewed_by=$1,reviewed_at=NOW(),updated_at=NOW() WHERE id=$2",[actor==='webhook'?null:actor,dep.id]);
  await client.query("UPDATE users SET status='active' WHERE id=$1 AND status<>'suspended'",[dep.user_id]);
  const rr=await client.query('SELECT r.*,u.status AS referrer_status,u.risk_score AS referrer_risk,u.signup_ip AS referrer_signup_ip,ru.signup_ip AS referred_signup_ip FROM referrals r JOIN users u ON u.id=r.referrer_id JOIN users ru ON ru.id=r.referred_user_id WHERE r.referred_user_id=$1 FOR UPDATE',[dep.user_id]);
  if(rr.rowCount&&rr.rows[0].status==='pending'){
    if(rr.rows[0].referrer_status==='active' && Number(rr.rows[0].referrer_risk)<80 && String(rr.rows[0].referrer_signup_ip||'')!==String(rr.rows[0].referred_signup_ip||'')){
    const s=await settings();
    await client.query("UPDATE referrals SET status='approved',approved_at=NOW() WHERE id=$1",[rr.rows[0].id]);
      await ledger(client,rr.rows[0].referrer_id,'referral_bonus',Number(s.referral_bonus),`REF-${rr.rows[0].id}`,'Eligible referral activation bonus');
    } else {
      await client.query("UPDATE referrals SET status='rejected' WHERE id=$1",[rr.rows[0].id]);
    }
  }
}

app.get('/api/health',(req,res)=>res.json({ok:true,name:'Cash Camp',version:'2.0.0'}));
app.get('/api/config',async(req,res)=>{const s=await settings();res.json({activationFee:Number(s.activation_fee),referralBonus:Number(s.referral_bonus),minWithdrawal:Number(s.min_withdrawal),paymentNumber:s.payment_number,paymentName:s.payment_name,currency:s.currency,provider:process.env.PAYMENT_PROVIDER||'manual'})});

app.post('/api/auth/register',limits.register,async(req,res)=>{
  try{
    let{name,email,phone,password,referralCode}=req.body;name=(name||'').trim();email=(email||'').trim().toLowerCase();phone=(phone||'').trim();
    if(!name||!/^\S+@\S+\.\S+$/.test(email)||!phone||!password||password.length<10)return res.status(400).json({error:'Valid name, email, phone and a 10+ character password are required'});
    const exists=await pool.query('SELECT id FROM users WHERE lower(email)=lower($1) OR phone=$2',[email,phone]);if(exists.rowCount)return res.status(409).json({error:'Email or phone already registered'});
    let ref=null;if(referralCode){const rr=await pool.query('SELECT id FROM users WHERE referral_code=$1 AND status<>\'suspended\'',[referralCode.trim().toUpperCase()]);if(!rr.rowCount)return res.status(400).json({error:'Invalid referral code'});ref=rr.rows[0].id}
    const code=('CC'+crypto.randomBytes(5).toString('hex')).slice(0,10).toUpperCase();const hash=await bcrypt.hash(password,12);
    const r=await pool.query('INSERT INTO users(name,email,phone,password_hash,referral_code,referred_by,signup_ip,signup_user_agent_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,name,email,phone,referral_code,status',[name,email,phone,hash,code,ref,ip(req),uaHash(req)]);
    if(ref)await pool.query('INSERT INTO referrals(referrer_id,referred_user_id,bonus) VALUES($1,$2,$3)',[ref,r.rows[0].id,Number(process.env.REFERRAL_BONUS||1000)]);
    const raw=await issueAuthToken(r.rows[0].id,'email_verify',24*60*60*1000);const verifyUrl=`${process.env.APP_URL||`http://localhost:${PORT}`}/?verify=${raw}`;
    await sendMail({to:email,subject:'Verify your Cash Camp email',text:`Verify your Cash Camp email: ${verifyUrl}\nThis link expires in 24 hours.`});
    await audit(r.rows[0].id,'auth.register','user',r.rows[0].id,req,{referred:!!ref});
    res.status(201).json({message:'Account created. Check your email to verify your address, then activate your account.'});
  }catch(e){console.error(e);res.status(500).json({error:'Registration failed'})}
});

app.post('/api/auth/verify-email',limits.verify,async(req,res)=>{try{const raw=String(req.body.token||'');if(raw.length<32)return res.status(400).json({error:'Invalid verification token'});const r=await pool.query("SELECT * FROM auth_tokens WHERE token_hash=$1 AND token_type='email_verify' AND used_at IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1",[sha(raw)]);if(!r.rowCount)return res.status(400).json({error:'Invalid or expired verification link'});await pool.query('BEGIN');await pool.query('UPDATE auth_tokens SET used_at=NOW() WHERE id=$1',[r.rows[0].id]);await pool.query('UPDATE users SET email_verified_at=NOW() WHERE id=$1',[r.rows[0].user_id]);await pool.query('COMMIT');await audit(r.rows[0].user_id,'auth.email_verified','user',r.rows[0].user_id,req);res.json({message:'Email verified. You can now log in.'})}catch(e){try{await pool.query('ROLLBACK')}catch{}res.status(500).json({error:'Verification failed'})}});

app.post('/api/auth/login',limits.login,async(req,res)=>{try{const identifier=(req.body.identifier||'').trim();const r=await pool.query('SELECT * FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1',[identifier]);if(!r.rowCount||!(await bcrypt.compare(req.body.password||'',r.rows[0].password_hash))){if(r.rowCount)await fraud(r.rows[0].id,'login_failed',2,req);return res.status(401).json({error:'Invalid login details'})}const u=r.rows[0];if(u.status==='suspended')return res.status(403).json({error:'Account suspended'});if(!u.email_verified_at)return res.status(403).json({error:'Verify your email before logging in'});await pool.query('UPDATE users SET last_login_at=NOW(),last_login_ip=$1 WHERE id=$2',[ip(req),u.id]);res.cookie('cc_token',sign(u),{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*86400000});await audit(u.id,'auth.login','user',u.id,req);res.json({user:{id:u.id,name:u.name,email:u.email,phone:u.phone,role:u.role,status:u.status}})}catch(e){console.error(e);res.status(500).json({error:'Login failed'})}});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('cc_token');res.json({ok:true})});

app.post('/api/auth/forgot-password',limits.reset,async(req,res)=>{const email=(req.body.email||'').trim().toLowerCase();const generic={message:'If an account exists for that email, a password reset link has been sent.'};try{const r=await pool.query('SELECT id,email FROM users WHERE lower(email)=lower($1)',[email]);if(r.rowCount){const raw=await issueAuthToken(r.rows[0].id,'password_reset',30*60*1000);const url=`${process.env.APP_URL||`http://localhost:${PORT}`}/?reset=${raw}`;await sendMail({to:r.rows[0].email,subject:'Cash Camp password reset',text:`Reset your password: ${url}\nThis link expires in 30 minutes and can be used once.`});await audit(r.rows[0].id,'auth.password_reset_requested','user',r.rows[0].id,req)}}catch(e){console.error(e)}res.json(generic)});
app.post('/api/auth/reset-password',limits.reset,async(req,res)=>{try{const raw=String(req.body.token||'');const password=String(req.body.password||'');if(password.length<10)return res.status(400).json({error:'Password must be at least 10 characters'});const r=await pool.query("SELECT * FROM auth_tokens WHERE token_hash=$1 AND token_type='password_reset' AND used_at IS NULL AND expires_at>NOW() LIMIT 1",[sha(raw)]);if(!r.rowCount)return res.status(400).json({error:'Invalid or expired reset token'});const hash=await bcrypt.hash(password,12);await pool.query('BEGIN');await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,r.rows[0].user_id]);await pool.query('UPDATE auth_tokens SET used_at=NOW() WHERE user_id=$1 AND token_type=\'password_reset\' AND used_at IS NULL',[r.rows[0].user_id]);await pool.query('COMMIT');await audit(r.rows[0].user_id,'auth.password_reset_completed','user',r.rows[0].user_id,req);res.json({message:'Password reset. You can now log in.'})}catch(e){try{await pool.query('ROLLBACK')}catch{}res.status(500).json({error:'Password reset failed'})}});

app.get('/api/me',auth,async(req,res)=>{const r=await pool.query('SELECT id,name,email,phone,referral_code,status,email_verified_at,balance,risk_score,created_at FROM users WHERE id=$1',[req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Account not found'});res.json(r.rows[0])});

app.post('/api/payments/start',auth,limits.payment,async(req,res)=>{try{const u=await pool.query('SELECT * FROM users WHERE id=$1',[req.user.id]);if(!u.rowCount)return res.status(404).json({error:'Account not found'});if(u.rows[0].status==='suspended')return res.status(403).json({error:'Account suspended'});const s=await settings();const amount=Number(s.activation_fee);const reference=`CC-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;const provider=getPaymentProvider();const result=await provider.createPayment({reference,amount,currency:s.currency||'UGX',phone:(req.body.phone||u.rows[0].phone).trim()});await pool.query("INSERT INTO deposits(user_id,amount,currency,payment_number,transaction_ref,provider,checkout_url,status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending')",[u.rows[0].id,amount,s.currency||'UGX',s.payment_number,reference,process.env.PAYMENT_PROVIDER||'manual',result.checkout_url||result.checkoutUrl||null]);await audit(req.user.id,'payment.created','deposit',reference,req,{provider:process.env.PAYMENT_PROVIDER||'manual',amount});res.json({reference,amount,currency:s.currency||'UGX',provider:process.env.PAYMENT_PROVIDER||'manual',checkoutUrl:result.checkout_url||result.checkoutUrl||null,message:(process.env.PAYMENT_PROVIDER||'manual')==='manual'?'Manual mode: send the payment and submit proof below.':'Payment initiated. Complete the provider checkout/payment request.'})}catch(e){console.error(e);res.status(400).json({error:e.message||'Could not start payment'})}});

app.post('/api/deposits',auth,upload.single('proof'),async(req,res)=>{try{const s=await settings();const amount=Number(req.body.amount);if(amount!==Number(s.activation_fee))return res.status(400).json({error:`Activation payment must be UGX ${Number(s.activation_fee).toLocaleString()}`});if(!req.body.transactionRef)return res.status(400).json({error:'Transaction reference is required'});if(!req.file)return res.status(400).json({error:'Payment screenshot is required'});const duplicate=await pool.query('SELECT id FROM deposits WHERE transaction_ref=$1',[req.body.transactionRef.trim()]);if(duplicate.rowCount){await fraud(req.user.id,'duplicate_payment_reference',20,req,{reference:req.body.transactionRef});return res.status(409).json({error:'That transaction reference has already been submitted'})}await pool.query("INSERT INTO deposits(user_id,amount,payment_number,transaction_ref,proof,proof_mime,provider,status) VALUES($1,$2,$3,$4,$5,$6,'manual','pending')",[req.user.id,amount,s.payment_number,req.body.transactionRef.trim(),req.file.buffer,req.file.mimetype]);await audit(req.user.id,'deposit.proof_submitted','deposit',req.body.transactionRef.trim(),req);res.json({message:'Deposit proof submitted for manual review.'})}catch(e){console.error(e);res.status(500).json({error:'Could not submit deposit'})}});
app.get('/api/deposits',auth,async(req,res)=>{const r=await pool.query('SELECT id,amount,currency,transaction_ref,provider,provider_ref,status,checkout_url,created_at,updated_at FROM deposits WHERE user_id=$1 ORDER BY id DESC',[req.user.id]);res.json(r.rows)});

app.get('/api/tasks',auth,active,async(req,res)=>{const r=await pool.query(`SELECT t.*,COALESCE((SELECT count(*) FROM task_completions c WHERE c.task_id=t.id AND c.user_id=$1 AND c.created_at>=CURRENT_DATE),0)::int AS completed_today FROM tasks t WHERE active=true ORDER BY id DESC`,[req.user.id]);res.json(r.rows)});
app.post('/api/tasks/:id/start',auth,active,limits.task,async(req,res)=>{try{const t=await pool.query('SELECT * FROM tasks WHERE id=$1 AND active=true',[req.params.id]);if(!t.rowCount)return res.status(404).json({error:'Task unavailable'});const task=t.rows[0];const c=await pool.query('SELECT count(*)::int n FROM task_completions WHERE task_id=$1 AND user_id=$2 AND created_at>=CURRENT_DATE',[task.id,req.user.id]);if(c.rows[0].n>=task.daily_limit)return res.status(429).json({error:'Daily limit reached'});const sessionId=crypto.randomUUID();await pool.query('INSERT INTO task_sessions(id,task_id,user_id,expires_at,ip,user_agent_hash) VALUES($1,$2,$3,NOW()+($4::int * interval \'1 second\'),$5,$6)',[sessionId,task.id,req.user.id,task.duration_seconds,ip(req),uaHash(req)]);await audit(req.user.id,'task.started','task',task.id,req);res.json({sessionId,durationSeconds:task.duration_seconds,url:task.url})}catch(e){console.error(e);res.status(500).json({error:'Could not start task'})}});
app.post('/api/tasks/:id/complete',auth,active,limits.task,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const s=await client.query('SELECT ts.*,t.reward,t.daily_limit,t.title FROM task_sessions ts JOIN tasks t ON t.id=ts.task_id WHERE ts.id=$1 AND ts.task_id=$2 AND ts.user_id=$3 FOR UPDATE',[req.body.sessionId,req.params.id,req.user.id]);if(!s.rowCount)throw new Error('Invalid task session');const session=s.rows[0];if(session.completed_at)throw new Error('Task session already used');if(new Date()<new Date(session.expires_at))throw new Error('Task duration has not elapsed');const c=await client.query('SELECT count(*)::int n FROM task_completions WHERE task_id=$1 AND user_id=$2 AND created_at>=CURRENT_DATE',[req.params.id,req.user.id]);if(c.rows[0].n>=session.daily_limit)throw new Error('Daily limit reached');await client.query('UPDATE task_sessions SET completed_at=NOW() WHERE id=$1',[session.id]);await client.query('INSERT INTO task_completions(task_id,user_id,session_id,reward) VALUES($1,$2,$3,$4)',[req.params.id,req.user.id,session.id,session.reward]);const balance=await ledger(client,req.user.id,'task_reward',session.reward,`TASK-${session.id}`,session.title);await client.query('COMMIT');await audit(req.user.id,'task.rewarded','task',req.params.id,req,{reward:session.reward});res.json({message:`UGX ${Number(session.reward).toLocaleString()} credited`,balance})}catch(e){await client.query('ROLLBACK');if(/duration/.test(e.message))await fraud(req.user.id,'early_task_claim',5,req,{taskId:req.params.id});res.status(400).json({error:e.message})}finally{client.release()}});

app.post('/api/withdrawals',auth,active,limits.withdraw,async(req,res)=>{const amount=Number(req.body.amount);const phone=(req.body.phone||'').trim();const s=await settings();if(!Number.isInteger(amount)||amount<Number(s.min_withdrawal))return res.status(400).json({error:`Minimum withdrawal is UGX ${Number(s.min_withdrawal).toLocaleString()}`});if(!/^\+?[0-9]{9,15}$/.test(phone))return res.status(400).json({error:'Enter a valid mobile-money number'});const client=await pool.connect();try{await client.query('BEGIN');const u=await client.query('SELECT balance,risk_score FROM users WHERE id=$1 FOR UPDATE',[req.user.id]);if(!u.rowCount||u.rows[0].balance<amount)throw new Error('Insufficient balance');if(u.rows[0].risk_score>=80)throw new Error('Withdrawal requires additional account review');const ref=`WD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;await ledger(client,req.user.id,'withdrawal_hold',-amount,ref,'Funds held for withdrawal processing');await client.query('INSERT INTO withdrawals(user_id,amount,phone,status) VALUES($1,$2,$3,\'pending\')',[req.user.id,amount,phone]);await client.query('COMMIT');await audit(req.user.id,'withdrawal.created','withdrawal',ref,req,{amount,phone});res.json({message:'Withdrawal request submitted for review.'})}catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}});
app.get('/api/withdrawals',auth,async(req,res)=>{const r=await pool.query('SELECT id,amount,phone,status,provider_ref,admin_note,created_at,reviewed_at FROM withdrawals WHERE user_id=$1 ORDER BY id DESC',[req.user.id]);res.json(r.rows)});
app.get('/api/transactions',auth,async(req,res)=>{const r=await pool.query('SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 100',[req.user.id]);res.json(r.rows)});
app.get('/api/referrals',auth,async(req,res)=>{const r=await pool.query(`SELECT r.id,u.name,u.email,r.bonus,r.status,r.created_at,r.approved_at FROM referrals r JOIN users u ON u.id=r.referred_user_id WHERE r.referrer_id=$1 ORDER BY r.id DESC`,[req.user.id]);res.json(r.rows)});
app.get('/api/proofs/:id',auth,admin,async(req,res)=>{const r=await pool.query('SELECT proof,proof_mime FROM deposits WHERE id=$1',[req.params.id]);if(!r.rowCount||!r.rows[0].proof)return res.sendStatus(404);res.type(r.rows[0].proof_mime).send(r.rows[0].proof)});

app.get('/api/admin/summary',auth,admin,async(req,res)=>{const [u,d,w,t,f]=await Promise.all([pool.query("SELECT count(*)::int n FROM users WHERE role='user'"),pool.query("SELECT count(*)::int n FROM deposits WHERE status IN ('pending','processing')"),pool.query("SELECT count(*)::int n FROM withdrawals WHERE status IN ('pending','processing')"),pool.query('SELECT count(*)::int n FROM tasks WHERE active'),pool.query("SELECT count(*)::int n FROM fraud_events WHERE created_at>NOW()-INTERVAL '24 hours'")]);res.json({users:u.rows[0].n,pendingDeposits:d.rows[0].n,pendingWithdrawals:w.rows[0].n,activeTasks:t.rows[0].n,fraud24h:f.rows[0].n})});
app.get('/api/admin/deposits',auth,admin,async(req,res)=>{const r=await pool.query(`SELECT d.id,d.amount,d.currency,d.transaction_ref,d.provider,d.provider_ref,d.status,d.created_at,u.name,u.email,u.phone FROM deposits d JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 200`);res.json(r.rows)});
app.post('/api/admin/deposits/:id/approve',auth,admin,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');await approveDeposit(client,req.params.id,req.user.id,req);await client.query('COMMIT');await audit(req.user.id,'deposit.approved','deposit',req.params.id,req);res.json({message:'Deposit approved and account activated'})}catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}});
app.post('/api/admin/deposits/:id/reject',auth,admin,async(req,res)=>{const r=await pool.query("UPDATE deposits SET status='rejected',reviewed_by=$1,reviewed_at=NOW(),updated_at=NOW() WHERE id=$2 AND status IN ('pending','processing') RETURNING id",[req.user.id,req.params.id]);if(!r.rowCount)return res.status(400).json({error:'Deposit is not pending'});await audit(req.user.id,'deposit.rejected','deposit',req.params.id,req,{});res.json({message:'Deposit rejected'})});
app.get('/api/admin/withdrawals',auth,admin,async(req,res)=>{const r=await pool.query(`SELECT w.*,u.name,u.email,u.phone AS account_phone FROM withdrawals w JOIN users u ON u.id=w.user_id ORDER BY w.id DESC LIMIT 200`);res.json(r.rows)});
app.post('/api/admin/withdrawals/:id/approve',auth,admin,async(req,res)=>{const r=await pool.query("UPDATE withdrawals SET status='paid',reviewed_by=$1,reviewed_at=NOW(),admin_note=$2 WHERE id=$3 AND status='pending' RETURNING id,amount,user_id",[req.user.id,req.body.note||'Paid',req.params.id]);if(!r.rowCount)return res.status(400).json({error:'Withdrawal is not pending'});await audit(req.user.id,'withdrawal.paid','withdrawal',req.params.id,req,{amount:r.rows[0].amount});res.json({message:'Withdrawal marked paid'})});
app.post('/api/admin/withdrawals/:id/reject',auth,admin,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const r=await client.query("SELECT * FROM withdrawals WHERE id=$1 FOR UPDATE",[req.params.id]);if(!r.rowCount||r.rows[0].status!=='pending')throw new Error('Withdrawal is not pending');const w=r.rows[0];await client.query("UPDATE withdrawals SET status='refunded',reviewed_by=$1,reviewed_at=NOW(),admin_note=$2 WHERE id=$3",[req.user.id,req.body.note||'Rejected',w.id]);await ledger(client,w.user_id,'withdrawal_refund',w.amount,`REFUND-${w.id}`,'Rejected withdrawal returned to wallet');await client.query('COMMIT');await audit(req.user.id,'withdrawal.refunded','withdrawal',req.params.id,req,{amount:w.amount});res.json({message:'Rejected and refunded'})}catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message})}finally{client.release()}});
app.post('/api/admin/tasks',auth,admin,async(req,res)=>{const {title,description,taskType,url,reward,durationSeconds,dailyLimit}=req.body;if(!title||!Number(reward))return res.status(400).json({error:'Title and reward required'});const r=await pool.query('INSERT INTO tasks(title,description,task_type,url,reward,duration_seconds,daily_limit) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[String(title).slice(0,160),description||'',taskType||'ad',url||'',Number(reward),Math.min(3600,Math.max(5,Number(durationSeconds)||15)),Math.max(1,Number(dailyLimit)||1)]);await audit(req.user.id,'task.created','task',r.rows[0].id,req,{reward:r.rows[0].reward});res.status(201).json(r.rows[0])});
app.get('/api/admin/tasks',auth,admin,async(req,res)=>res.json((await pool.query('SELECT * FROM tasks ORDER BY id DESC')).rows));
app.post('/api/admin/tasks/:id/toggle',auth,admin,async(req,res)=>{const r=await pool.query('UPDATE tasks SET active=NOT active WHERE id=$1 RETURNING *',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Task not found'});await audit(req.user.id,'task.toggled','task',req.params.id,req);res.json(r.rows[0])});
app.get('/api/admin/users',auth,admin,async(req,res)=>res.json((await pool.query('SELECT id,name,email,phone,status,email_verified_at,balance,risk_score,referral_code,created_at FROM users ORDER BY id DESC LIMIT 300')).rows));
app.post('/api/admin/users/:id/status',auth,admin,async(req,res)=>{const allowed=['pending','active','suspended'];if(!allowed.includes(req.body.status))return res.status(400).json({error:'Invalid status'});const r=await pool.query('UPDATE users SET status=$1 WHERE id=$2 RETURNING id,status',[req.body.status,req.params.id]);if(!r.rowCount)return res.status(404).json({error:'User not found'});await audit(req.user.id,'user.status_changed','user',req.params.id,req,{status:req.body.status});res.json(r.rows[0])});
app.get('/api/admin/audit',auth,admin,async(req,res)=>res.json((await pool.query('SELECT id,actor_user_id,action,target_type,target_id,ip,metadata,created_at FROM audit_logs ORDER BY id DESC LIMIT 300')).rows));
app.get('/api/admin/fraud',auth,admin,async(req,res)=>res.json((await pool.query('SELECT id,user_id,event_type,severity,ip,details,created_at FROM fraud_events ORDER BY id DESC LIMIT 300')).rows));

// Frontend fallback
// IMPORTANT: Keep this AFTER all /api routes.
app.use((req,res)=>{
  res.sendFile(path.join(__dirname,'../public/index.html'));
});

(async()=>{
  try{
    await pool.query('SELECT 1');

await pool.query(
  fs.readFileSync(
    path.join(__dirname,'../sql/schema.sql'),
    'utf8'
  )
);

const email=process.env.ADMIN_EMAIL;
const password=process.env.ADMIN_PASSWORD;

if(email&&password){
  const h=await bcrypt.hash(password,12);

  await pool.query(
    `INSERT INTO users(
      name,
      email,
      phone,
      password_hash,
      referral_code,
      role,
      status,
      email_verified_at
    )
    VALUES(
      'Cash Camp Admin',
      $1,
      'ADMIN',
      $2,
      'ADMIN',
      'admin',
      'active',
      NOW()
    )
    ON CONFLICT(email) DO NOTHING`,
    [email,h]
  );
}

app.listen(
  PORT,
  '0.0.0.0',
  ()=>console.log(`Cash Camp v2 listening on ${PORT}`)
);

}catch(e){
  console.error('Startup failed',e);
  process.exit(1);
}
})();
