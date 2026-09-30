const app=document.getElementById('app');
let me=null,config=null;

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
}[c]));

const money=n=>'UGX '+Number(n||0).toLocaleString();

async function api(url,opt={}){
  const r=await fetch(url,opt);
  let d={};
  try{d=await r.json()}catch{}
  if(!r.ok)throw Error(d.error||'Request failed');
  return d;
}

/* =========================
   BUTTON LOADING HELPERS
========================= */

function setButtonLoading(button,text='⏳ Processing...'){
  if(!button)return ()=>{};

  const originalText=button.innerHTML;
  const originalDisabled=button.disabled;

  button.disabled=true;
  button.innerHTML=text;
  button.style.opacity='0.7';
  button.style.cursor='not-allowed';

  return ()=>{
    button.disabled=originalDisabled;
    button.innerHTML=originalText;
    button.style.opacity='';
    button.style.cursor='';
  };
}

async function withButtonLoading(button,action,text='⏳ Processing...'){
  if(!button||button.disabled)return;

  const restore=setButtonLoading(button,text);

  try{
    return await action();
  }finally{
    restore();
  }
}

/* =========================
   LAYOUT
========================= */

function layout(body){
  app.innerHTML=`
    <div class="wrap">
      <div class="nav">
        <div class="logo">💰 Cash <span>Camp</span></div>

        <div class="actions">
          <span class="muted">${esc(me?.name||'')}</span>
          <button class="secondary" onclick="logout()">Logout</button>
        </div>
      </div>

      ${body}

      <div class="footer">
        Cash Camp • Rewards are subject to task availability,
        validation, fraud controls and platform rules.
      </div>
    </div>
  `;
}

/* =========================
   LANDING PAGE
========================= */

function landing(message=''){
  app.innerHTML=`
    <div class="wrap">

      <div class="nav">
        <div class="logo">💰 Cash <span>Camp</span></div>

        <div class="actions">
          <button onclick="authBox('login')" class="secondary">
            Login
          </button>

          <button onclick="authBox('register')">
            Create account
          </button>
        </div>
      </div>

      <section class="hero">

        <div>
          <span class="badge">EARN • COMPLETE • REDEEM</span>

          <h1>
            Turn tasks into
            <span style="color:#22c55e">rewards.</span>
          </h1>

          <p>
            Complete available advertising and video tasks,
            track validated rewards, invite eligible referrals
            and request withdrawals.
          </p>

          ${
            message
              ? `<div class="notice success">${esc(message)}</div>`
              : ''
          }

          <div class="actions">
            <button onclick="authBox('register')">
              Start earning
            </button>

            <button class="secondary" onclick="authBox('login')">
              I already have an account
            </button>
          </div>
        </div>

        <div class="card">
          <h2>Activate your account</h2>

          <p class="muted">
            Current activation payment
          </p>

          <h1 id="fee">—</h1>

          <div class="notice">
            Pay to <b id="payname">—</b><br>
            <b id="paynum">—</b>
          </div>

          <small class="muted">
            Payment verification is required before earning
            features are enabled. A payment does not guarantee profits.
          </small>
        </div>

      </section>

      <div class="grid">

        <div class="card">
          <h3>📺 Ad tasks</h3>
          <p class="muted">
            Complete available short advertising tasks and
            receive the configured reward after server validation.
          </p>
        </div>

        <div class="card">
          <h3>🎬 Video tasks</h3>
          <p class="muted">
            Complete eligible video tasks published by Cash Camp.
          </p>
        </div>

        <div class="card">
          <h3>👥 Referrals</h3>
          <p class="muted">
            Earn the configured UGX 1,000 referral reward
            when a referred member becomes eligible.
          </p>
        </div>

      </div>

    </div>

    <div id="modal"></div>
  `;

  api('/api/config')
    .then(c=>{
      config=c;

      const fee=document.getElementById('fee');
      const payname=document.getElementById('payname');
      const paynum=document.getElementById('paynum');

      if(fee)fee.textContent=money(c.activationFee);
      if(payname)payname.textContent=c.paymentName;
      if(paynum)paynum.textContent=c.paymentNumber;
    })
    .catch(e=>{
      console.error('Config error:',e);
    });
}

/* =========================
   AUTH MODAL
========================= */

function authBox(mode){

  const modal=document.getElementById('modal');

  if(!modal)return;

  const forgot=
    mode==='login'
      ? `<p>
          <button class="link" onclick="authBox('forgot')">
            Forgot password?
          </button>
        </p>`
      : '';

  modal.innerHTML=`
    <div class="modal">
      <div class="card">

        <button
          class="secondary"
          style="float:right"
          onclick="document.getElementById('modal').innerHTML=''"
        >
          ✕
        </button>

        <h2>
          ${
            mode==='login'
              ? 'Welcome back'
              : mode==='register'
                ? 'Create Cash Camp account'
                : 'Reset password'
          }
        </h2>

        ${
          mode==='forgot'

          ? `
            <form onsubmit="forgot(event)">

              <label>Email</label>

              <input
                name="email"
                type="email"
                required
              >

              <button
                type="submit"
                style="width:100%"
              >
                Send reset link
              </button>

            </form>
          `

          : mode==='reset'

          ? `
            <form onsubmit="resetPassword(event)">

              <input
                type="hidden"
                name="token"
                value="${esc(
                  new URLSearchParams(location.search).get('reset')||''
                )}"
              >

              <label>New password</label>

              <input
                name="password"
                type="password"
                minlength="10"
                required
              >

              <label>Confirm password</label>

              <input
                name="confirm"
                type="password"
                minlength="10"
                required
              >

              <button
                type="submit"
                style="width:100%"
              >
                Reset password
              </button>

            </form>
          `

          : `
            <form
              onsubmit="${
                mode==='login'
                  ? 'login(event)'
                  : 'register(event)'
              }"
            >

              ${
                mode==='register'
                  ? `
                    <label>Full name</label>

                    <input
                      name="name"
                      required
                    >

                    <label>Phone number</label>

                    <input
                      name="phone"
                      required
                    >
                  `
                  : ''
              }

              ${
                mode==='login'
                  ? `
                    <label>Email or phone</label>

                    <input
                      name="identifier"
                      required
                    >
                  `
                  : `
                    <label>Email</label>

                    <input
                      name="email"
                      type="email"
                      required
                    >
                  `
              }

              ${
                mode==='register'
                  ? `
                    <label>
                      Referral code (optional)
                    </label>

                    <input name="referralCode">
                  `
                  : ''
              }

              <label>Password</label>

              <input
                name="password"
                type="password"
                minlength="10"
                required
              >

              <button
                type="submit"
                style="width:100%"
              >
                ${
                  mode==='login'
                    ? 'Login'
                    : 'Create account'
                }
              </button>

            </form>

            ${forgot}
          `
        }

      </div>
    </div>
  `;
}

/* =========================
   LOGIN
========================= */

async function login(e){
  e.preventDefault();

  const form=e.target;
  const button=form.querySelector('button[type="submit"]');

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Logging in...'
  );

  try{

    await api('/api/auth/login',{
      method:'POST',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify(
        Object.fromEntries(new FormData(form))
      )
    });

    button.innerHTML='✓ Logged in';

    history.replaceState(
      {},
      '',
      location.pathname
    );

    await boot();

  }catch(x){

    alert(x.message);

    restore();
  }
}

/* =========================
   REGISTER
========================= */

async function register(e){
  e.preventDefault();

  const form=e.target;
  const button=form.querySelector('button[type="submit"]');

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Creating account...'
  );

  try{

    const d=await api('/api/auth/register',{
      method:'POST',
      headers:{
        'Content-Type':'application/json'
      },
      body:JSON.stringify(
        Object.fromEntries(new FormData(form))
      )
    });

    button.innerHTML='✓ Account created';

    alert(d.message);

    document.getElementById('modal').innerHTML='';

    authBox('login');

  }catch(x){

    alert(x.message);

    restore();
  }
}

/* =========================
   FORGOT PASSWORD
========================= */

async function forgot(e){
  e.preventDefault();

  const form=e.target;
  const button=form.querySelector('button[type="submit"]');

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Sending...'
  );

  try{

    const d=await api(
      '/api/auth/forgot-password',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify(
          Object.fromEntries(
            new FormData(form)
          )
        )
      }
    );

    alert(d.message);

  }catch(x){

    alert(x.message);

  }finally{

    restore();
  }
}

/* =========================
   RESET PASSWORD
========================= */

async function resetPassword(e){
  e.preventDefault();

  const form=e.target;
  const button=form.querySelector('button[type="submit"]');

  const f=Object.fromEntries(
    new FormData(form)
  );

  if(f.password!==f.confirm){
    alert('Passwords do not match');
    return;
  }

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Resetting...'
  );

  try{

    const d=await api(
      '/api/auth/reset-password',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          token:f.token,
          password:f.password
        })
      }
    );

    alert(d.message);

    history.replaceState(
      {},
      '',
      location.pathname
    );

    authBox('login');

  }catch(x){

    alert(x.message);

  }finally{

    restore();
  }
}

/* =========================
   EMAIL VERIFICATION
========================= */

async function verifyEmail(token){

  try{

    const d=await api(
      '/api/auth/verify-email',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({token})
      }
    );

    history.replaceState(
      {},
      '',
      location.pathname
    );

    landing(d.message);

  }catch(x){

    landing(x.message);
  }
}

/* =========================
   BOOT
========================= */

async function boot(){

  const q=new URLSearchParams(
    location.search
  );

  if(q.get('verify')){
    return verifyEmail(
      q.get('verify')
    );
  }

  try{

    me=await api('/api/me');
    config=await api('/api/config');

    if(me.role==='admin'){
      adminDash();
    }else{
      userDash();
    }

  }catch{

    if(q.get('reset')){

      landing();
      authBox('reset');

    }else{

      landing();
    }
  }
}

/* =========================
   LOGOUT
========================= */

async function logout(){

  try{

    await api(
      '/api/auth/logout',
      {
        method:'POST'
      }
    );

  }catch{}

  me=null;

  landing();
}

/* =========================
   USER DASHBOARD
========================= */

async function userDash(){

  layout(`
    <h1>Dashboard</h1>

    <div class="stats">

      <div class="card">
        <span class="muted">Balance</span>
        <strong>${money(me.balance)}</strong>
      </div>

      <div class="card">
        <span class="muted">Status</span>
        <strong>${esc(me.status)}</strong>
      </div>

      <div class="card">
        <span class="muted">Email</span>
        <strong>
          ${
            me.email_verified_at
              ? 'Verified'
              : 'Unverified'
          }
        </strong>
      </div>

      <div class="card">
        <span class="muted">Referral reward</span>
        <strong>
          ${money(config.referralBonus)}
        </strong>
      </div>

    </div>

    <div class="tabs">

      <button onclick="userTab('tasks')">
        Tasks
      </button>

      <button onclick="userTab('deposit')">
        Activate / Deposit
      </button>

      <button onclick="userTab('withdraw')">
        Withdraw
      </button>

      <button onclick="userTab('referrals')">
        Referrals
      </button>

      <button onclick="userTab('transactions')">
        Transactions
      </button>

    </div>

    <div id="panel"></div>
  `);

  userTab('tasks');
}

/* =========================
   USER TABS
========================= */

async function userTab(tab){

  const p=document.getElementById('panel');

  if(!p)return;

  p.innerHTML=`
    <div class="card">
      <p class="muted">⏳ Loading...</p>
    </div>
  `;

  try{

    if(tab==='tasks'){

      let ts=[];

      try{
        ts=await api('/api/tasks');
      }catch(e){

        p.innerHTML=`
          <div class="card">
            <div class="notice warn">
              ${esc(e.message)}
            </div>
          </div>
        `;

        return;
      }

      p.innerHTML=`
        <div class="card">

          <h2>Available tasks</h2>

          ${
            me.status!=='active'
              ? `
                <div class="notice warn">
                  Your account is not active yet.
                  Complete verified activation before
                  claiming rewards.
                </div>
              `
              : ''
          }

          ${
            ts.length

            ? ts.map(t=>`

              <div class="card task topspace">

                <div>

                  <b>${esc(t.title)}</b>

                  <p class="muted">
                    ${esc(t.description||'')}
                    <br>

                    Reward:
                    <b>${money(t.reward)}</b>

                    • ${t.duration_seconds}s

                    • ${t.completed_today}/${t.daily_limit}
                    today
                  </p>

                </div>

                <button
                  ${
                    t.completed_today>=t.daily_limit
                      ? 'disabled'
                      : ''
                  }
                  onclick="startTask(${t.id},this)"
                >
                  Start
                </button>

              </div>

            `).join('')

            : `
              <p class="muted">
                No active tasks.
              </p>
            `
          }

        </div>
      `;

    }else if(tab==='deposit'){

      const ds=await api('/api/deposits');

      p.innerHTML=`

        <div class="card">

          <h2>Activate / Deposit</h2>

          <div class="notice">
            Amount:
            <b>${money(config.activationFee)}</b>
            <br>

            Recipient:
            <b>${esc(config.paymentName)}</b>
            —
            <b>${esc(config.paymentNumber)}</b>
          </div>

          <button onclick="startPayment(this)">
            ${
              config.provider==='http'
                ? 'Start verified payment'
                : 'Show manual payment instructions'
            }
          </button>

          <hr>

          <h3>Manual proof fallback</h3>

          <p class="muted">
            Use this only when your administrator
            has enabled manual reconciliation.
          </p>

          <form onsubmit="deposit(event)">

            <label>Transaction reference</label>

            <input
              name="transactionRef"
              required
            >

            <label>Payment screenshot</label>

            <input
              name="proof"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              required
            >

            <button type="submit">
              Submit proof
            </button>

          </form>

          <h3>History</h3>

          ${
            ds.map(x=>`
              <p>
                ${money(x.amount)}
                • ${esc(x.transaction_ref)}
                •
                <span class="badge">
                  ${esc(x.status)}
                </span>
              </p>
            `).join('')
          }

        </div>
      `;

    }else if(tab==='withdraw'){

      const ws=await api('/api/withdrawals');

      p.innerHTML=`

        <div class="card">

          <h2>Withdraw</h2>

          <p class="muted">
            Minimum:
            ${money(config.minWithdrawal)}.
            Requests are held until reviewed.
          </p>

          <form onsubmit="withdraw(event)">

            <label>Amount</label>

            <input
              name="amount"
              type="number"
              min="${config.minWithdrawal}"
              required
            >

            <label>Mobile-money number</label>

            <input
              name="phone"
              required
            >

            <button type="submit">
              Request withdrawal
            </button>

          </form>

          <h3>History</h3>

          ${
            ws.map(x=>`
              <p>
                ${money(x.amount)}
                →
                ${esc(x.phone)}
                •
                <span class="badge">
                  ${esc(x.status)}
                </span>
              </p>
            `).join('')
          }

        </div>
      `;

    }else if(tab==='referrals'){

      const rs=await api('/api/referrals');

      p.innerHTML=`

        <div class="card">

          <h2>Refer & earn</h2>

          <div class="notice">
            Your referral code:
            <b>${esc(me.referral_code)}</b>
            <br>

            Bonus:
            <b>${money(config.referralBonus)}</b>
            after eligibility/verification.
          </div>

          ${
            rs.length

              ? rs.map(x=>`
                  <p>
                    ${esc(x.name)}
                    • ${money(x.bonus)}
                    • ${esc(x.status)}
                  </p>
                `).join('')

              : `
                <p class="muted">
                  No referrals yet.
                </p>
              `
          }

        </div>
      `;

    }else{

      const tx=await api('/api/transactions');

      p.innerHTML=`

        <div class="card">

          <h2>Wallet ledger</h2>

          <table>

            <tr>
              <th>Type</th>
              <th>Amount</th>
              <th>Balance</th>
              <th>Date</th>
            </tr>

            ${
              tx.map(x=>`

                <tr>

                  <td>${esc(x.type)}</td>

                  <td>
                    ${money(x.amount)}
                  </td>

                  <td>
                    ${money(x.balance_after)}
                  </td>

                  <td>
                    ${new Date(
                      x.created_at
                    ).toLocaleString()}
                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;
    }

  }catch(e){

    p.innerHTML=`
      <div class="card">
        <div class="notice warn">
          ${esc(e.message)}
        </div>
      </div>
    `;
  }
}

/* =========================
   START PAYMENT
========================= */

async function startPayment(button){

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Starting payment...'
  );

  try{

    const d=await api(
      '/api/payments/start',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({})
      }
    );

    if(d.checkoutUrl){

      window.open(
        d.checkoutUrl,
        '_blank',
        'noopener'
      );

    }else{

      alert(
        `${d.message}\nReference: ${d.reference}\nAmount: ${money(d.amount)}`
      );
    }

    await userTab('deposit');

  }catch(e){

    alert(e.message);

  }finally{

    restore();
  }
}

/* =========================
   START TASK
========================= */

async function startTask(id,button){

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Starting...'
  );

  try{

    const d=await api(
      '/api/tasks/'+id+'/start',
      {
        method:'POST'
      }
    );

    if(d.url){

      window.open(
        d.url,
        '_blank',
        'noopener'
      );
    }

    let n=d.durationSeconds;

    alert(
      `Task started. Keep the task open for ${n} seconds, then return here.`
    );

    restore();

    button.disabled=true;
    button.innerHTML='⏳ Running...';

    const wait=setInterval(
      async()=>{
        n--;

        button.innerHTML=
          `⏳ ${n}s remaining`;

        if(n<=0){

          clearInterval(wait);

          button.innerHTML=
            '⏳ Validating...';

          try{

            const r=await api(
              '/api/tasks/'+id+'/complete',
              {
                method:'POST',
                headers:{
                  'Content-Type':'application/json'
                },
                body:JSON.stringify({
                  sessionId:d.sessionId
                })
              }
            );

            alert(r.message);

            await boot();

          }catch(e){

            alert(e.message);

            await userTab('tasks');
          }
        }

      },
      1000
    );

  }catch(e){

    alert(e.message);

    restore();
  }
}

/* =========================
   DEPOSIT PROOF
========================= */

async function deposit(e){

  e.preventDefault();

  const form=e.target;
  const button=form.querySelector(
    'button[type="submit"]'
  );

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Submitting proof...'
  );

  const f=new FormData(form);

  f.append(
    'amount',
    config.activationFee
  );

  try{

    const d=await api(
      '/api/deposits',
      {
        method:'POST',
        body:f
      }
    );

    alert(d.message);

    await userTab('deposit');

  }catch(x){

    alert(x.message);

  }finally{

    restore();
  }
}

/* =========================
   WITHDRAW
========================= */

async function withdraw(e){

  e.preventDefault();

  const form=e.target;
  const button=form.querySelector(
    'button[type="submit"]'
  );

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Requesting...'
  );

  try{

    const d=await api(
      '/api/withdrawals',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify(
          Object.fromEntries(
            new FormData(form)
          )
        )
      }
    );

    alert(d.message);

    await boot();

  }catch(x){

    alert(x.message);

  }finally{

    restore();
  }
}

/* =========================
   ADMIN DASHBOARD
========================= */

async function adminDash(){

  layout(`
    <h1>Admin Dashboard</h1>

    <div id="adminPanel"></div>
  `);

  adminTab('summary');
}

/* =========================
   ADMIN TABS
========================= */

async function adminTab(tab){

  const p=document.getElementById(
    'adminPanel'
  );

  if(!p)return;

  p.innerHTML=`
    <div class="card">
      <p class="muted">
        ⏳ Loading...
      </p>
    </div>
  `;

  try{

    if(tab==='summary'){

      const s=await api(
        '/api/admin/summary'
      );

      p.innerHTML=`

        <div class="stats">

          <div class="card">
            <span class="muted">Users</span>
            <strong>${s.users}</strong>
          </div>

          <div class="card">
            <span class="muted">Pending deposits</span>
            <strong>${s.pendingDeposits}</strong>
          </div>

          <div class="card">
            <span class="muted">Pending withdrawals</span>
            <strong>${s.pendingWithdrawals}</strong>
          </div>

          <div class="card">
            <span class="muted">Fraud events 24h</span>
            <strong>${s.fraud24h}</strong>
          </div>

        </div>

        <div class="tabs">

          <button onclick="adminTab('deposits')">
            Deposits
          </button>

          <button onclick="adminTab('withdrawals')">
            Withdrawals
          </button>

          <button onclick="adminTab('tasks')">
            Tasks
          </button>

          <button onclick="adminTab('users')">
            Users
          </button>

          <button onclick="adminTab('audit')">
            Audit
          </button>

          <button onclick="adminTab('fraud')">
            Fraud
          </button>

        </div>
      `;

    }else if(tab==='deposits'){

      const ds=await api(
        '/api/admin/deposits'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Deposit verification</h2>

          <table>

            <tr>
              <th>User</th>
              <th>Amount</th>
              <th>Provider</th>
              <th>Ref</th>
              <th>Status</th>
              <th>Action</th>
            </tr>

            ${
              ds.map(x=>`

                <tr>

                  <td>
                    ${esc(x.name)}
                    <br>
                    ${esc(x.phone)}
                  </td>

                  <td>
                    ${money(x.amount)}
                  </td>

                  <td>
                    ${esc(x.provider)}
                  </td>

                  <td>
                    ${esc(x.transaction_ref)}
                  </td>

                  <td>
                    ${esc(x.status)}
                  </td>

                  <td>

                    ${
                      ['pending','processing','created']
                        .includes(x.status)

                      ? `
                        <a
                          href="/api/proofs/${x.id}"
                          target="_blank"
                        >
                          Proof
                        </a>

                        <button
                          onclick="depAction(${x.id},'approve',this)"
                        >
                          Approve
                        </button>

                        <button
                          class="danger"
                          onclick="depAction(${x.id},'reject',this)"
                        >
                          Reject
                        </button>
                      `

                      : '—'
                    }

                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;

    }else if(tab==='withdrawals'){

      const ws=await api(
        '/api/admin/withdrawals'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Withdrawals</h2>

          <table>

            <tr>
              <th>User</th>
              <th>Amount</th>
              <th>Number</th>
              <th>Status</th>
              <th>Action</th>
            </tr>

            ${
              ws.map(x=>`

                <tr>

                  <td>
                    ${esc(x.name)}
                  </td>

                  <td>
                    ${money(x.amount)}
                  </td>

                  <td>
                    ${esc(x.phone)}
                  </td>

                  <td>
                    ${esc(x.status)}
                  </td>

                  <td>

                    ${
                      x.status==='pending'

                      ? `
                        <button
                          onclick="wdAction(${x.id},'approve',this)"
                        >
                          Mark paid
                        </button>

                        <button
                          class="danger"
                          onclick="wdAction(${x.id},'reject',this)"
                        >
                          Reject/refund
                        </button>
                      `

                      : '—'
                    }

                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;

    }else if(tab==='tasks'){

      const ts=await api(
        '/api/admin/tasks'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Create task</h2>

          <form onsubmit="createTask(event)">

            <input
              name="title"
              placeholder="Task title"
              required
            >

            <textarea
              name="description"
              placeholder="Description"
            ></textarea>

            <input
              name="url"
              placeholder="Destination URL"
            >

            <input
              name="reward"
              type="number"
              placeholder="Reward UGX"
              required
            >

            <input
              name="durationSeconds"
              type="number"
              value="15"
            >

            <input
              name="dailyLimit"
              type="number"
              value="1"
            >

            <button type="submit">
              Create task
            </button>

          </form>

          <h2>Tasks</h2>

          ${
            ts.map(x=>`

              <p>

                <b>${esc(x.title)}</b>

                • ${money(x.reward)}

                • ${x.active?'Active':'Off'}

                <button
                  class="secondary"
                  onclick="toggleTask(${x.id},this)"
                >
                  Toggle
                </button>

              </p>

            `).join('')
          }

        </div>
      `;

    }else if(tab==='users'){

      const us=await api(
        '/api/admin/users'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Users</h2>

          <table>

            <tr>
              <th>Name</th>
              <th>Contact</th>
              <th>Verified</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Balance</th>
              <th>Action</th>
            </tr>

            ${
              us.map(x=>`

                <tr>

                  <td>
                    ${esc(x.name)}
                  </td>

                  <td>
                    ${esc(x.email)}
                    <br>
                    ${esc(x.phone)}
                  </td>

                  <td>
                    ${
                      x.email_verified_at
                        ? 'Yes'
                        : 'No'
                    }
                  </td>

                  <td>
                    ${esc(x.status)}
                  </td>

                  <td>
                    ${x.risk_score}
                  </td>

                  <td>
                    ${money(x.balance)}
                  </td>

                  <td>

                    <select
                      onchange="setStatus(${x.id},this.value)"
                    >

                      <option value="">
                        Change
                      </option>

                      <option>
                        active
                      </option>

                      <option>
                        pending
                      </option>

                      <option>
                        suspended
                      </option>

                    </select>

                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;

    }else if(tab==='audit'){

      const a=await api(
        '/api/admin/audit'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Audit log</h2>

          <table>

            <tr>
              <th>Action</th>
              <th>Target</th>
              <th>IP</th>
              <th>Metadata</th>
              <th>Date</th>
            </tr>

            ${
              a.map(x=>`

                <tr>

                  <td>
                    ${esc(x.action)}
                  </td>

                  <td>
                    ${esc(x.target_type)}:
                    ${esc(x.target_id)}
                  </td>

                  <td>
                    ${esc(x.ip)}
                  </td>

                  <td>
                    ${esc(
                      JSON.stringify(
                        x.metadata
                      )
                    )}
                  </td>

                  <td>
                    ${new Date(
                      x.created_at
                    ).toLocaleString()}
                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;

    }else{

      const f=await api(
        '/api/admin/fraud'
      );

      p.innerHTML=`

        <div class="card">

          <h2>Fraud events</h2>

          <table>

            <tr>
              <th>User</th>
              <th>Event</th>
              <th>Severity</th>
              <th>IP</th>
              <th>Details</th>
              <th>Date</th>
            </tr>

            ${
              f.map(x=>`

                <tr>

                  <td>
                    ${esc(x.user_id)}
                  </td>

                  <td>
                    ${esc(x.event_type)}
                  </td>

                  <td>
                    ${x.severity}
                  </td>

                  <td>
                    ${esc(x.ip)}
                  </td>

                  <td>
                    ${esc(
                      JSON.stringify(
                        x.details
                      )
                    )}
                  </td>

                  <td>
                    ${new Date(
                      x.created_at
                    ).toLocaleString()}
                  </td>

                </tr>

              `).join('')
            }

          </table>

        </div>
      `;
    }

  }catch(e){

    p.innerHTML=`
      <div class="card">
        <div class="notice warn">
          ${esc(e.message)}
        </div>
      </div>
    `;
  }
}

/* =========================
   ADMIN DEPOSIT ACTION
========================= */

async function depAction(id,a,button){

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    a==='approve'
      ? '⏳ Approving...'
      : '⏳ Rejecting...'
  );

  try{

    await api(
      `/api/admin/deposits/${id}/${a}`,
      {
        method:'POST'
      }
    );

    await adminTab('deposits');

  }catch(e){

    alert(e.message);

  }finally{

    restore();
  }
}

/* =========================
   ADMIN WITHDRAWAL ACTION
========================= */

async function wdAction(id,a,button){

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    a==='approve'
      ? '⏳ Processing...'
      : '⏳ Rejecting...'
  );

  try{

    await api(
      `/api/admin/withdrawals/${id}/${a}`,
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          note:
            a==='approve'
              ? 'Paid by admin'
              : 'Rejected by admin'
        })
      }
    );

    await adminTab('withdrawals');

  }catch(e){

    alert(e.message);

  }finally{

    restore();
  }
}

/* =========================
   ADMIN CREATE TASK
========================= */

async function createTask(e){

  e.preventDefault();

  const form=e.target;

  const button=form.querySelector(
    'button[type="submit"]'
  );

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Creating task...'
  );

  try{

    await api(
      '/api/admin/tasks',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify(
          Object.fromEntries(
            new FormData(form)
          )
        )
      }
    );

    await adminTab('tasks');

  }catch(x){

    alert(x.message);

  }finally{

    restore();
  }
}

/* =========================
   ADMIN TOGGLE TASK
========================= */

async function toggleTask(id,button){

  if(button?.disabled)return;

  const restore=setButtonLoading(
    button,
    '⏳ Updating...'
  );

  try{

    await api(
      '/api/admin/tasks/'+id+'/toggle',
      {
        method:'POST'
      }
    );

    await adminTab('tasks');

  }catch(e){

    alert(e.message);

  }finally{

    restore();
  }
}

/* =========================
   ADMIN USER STATUS
========================= */

async function setStatus(id,status){

  if(!status)return;

  try{

    await api(
      '/api/admin/users/'+id+'/status',
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json'
        },
        body:JSON.stringify({status})
      }
    );

    await adminTab('users');

  }catch(e){

    alert(e.message);
  }
}

/* =========================
   START APPLICATION
========================= */

boot();
