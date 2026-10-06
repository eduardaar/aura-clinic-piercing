const {spawn}=require('node:child_process'); const fs=require('node:fs'); const path=require('node:path');
(async()=>{
 const base=path.resolve(__dirname,'../..');process.chdir(base);const dotenv=require(path.join(base,'backend/node_modules/dotenv')); dotenv.config({path:'backend/.env',quiet:true});dotenv.config({path:'.env',quiet:true});
 const {Client}=require(path.join(base,'backend/node_modules/pg'));const url=new URL(process.env.DATABASE_URL);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local database required');
 const admin=new Client({connectionString:url.toString()});await admin.connect();const name='aura_qa_responsive_'+process.pid;await admin.query('CREATE DATABASE "'+name+'"');url.pathname='/'+name;
 try {
 const env={...process.env,DATABASE_URL:url.toString(),DATABASE_SSL:'false',TEST_PORT:process.env.AURA_TEST_PORT||'4299',AUTH_SECRET:'qa-responsive-local-only-secret-20261006',REDIS_URL:'',NODE_ENV:'test'};
 for(const key of Object.keys(env))if(/^(R2_|ASAAS_|RESEND_|SMTP_|OPENAI_|GEMINI_|WHATSAPP_|EMAIL_)/.test(key))env[key]='';
 const log=path.join(process.env.TEMP,'aura-responsive-backend-tests.log');const out=fs.openSync(log,'w');console.log('Running against isolated database; log: '+log);
 const child=spawn(process.execPath,['tests/run-suite.mjs',...process.argv.slice(2)],{cwd:path.resolve('backend'),env,stdio:['ignore',out,out]});
 const code=await new Promise(resolve=>child.on('exit',resolve));fs.closeSync(out);console.log(fs.readFileSync(log,'utf8').slice(-5000));process.exitCode=code;
 } finally {await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1});
