require('dotenv').config();
const fs=require('fs'); const path=require('path'); const {pool}=require('./db');
(async()=>{try{await pool.query(fs.readFileSync(path.join(__dirname,'../sql/schema.sql'),'utf8')); console.log('Cash Camp v2 database initialized.');}catch(e){console.error(e);process.exitCode=1}finally{await pool.end()}})();
