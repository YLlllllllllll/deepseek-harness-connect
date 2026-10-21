// Real SSH and model-list fixtures for the actual Electron windows. No model runs.
const {Server}=require('../macapp/node_modules/ssh2');
const {createServer}=require('node:http');
const {generateKeyPairSync,randomBytes}=require('node:crypto');
const {spawn}=require('node:child_process');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
async function main(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'harness-full-ui-'));
  const project=path.join(root,'fixture-project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'probe.txt'),'REMOTE_FIXTURE_OK\n');
  const password=randomBytes(18).toString('hex');let authentications=0,inferences=0,closing=false;const processes=new Set(),clients=new Set();
  const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs1',format:'pem'},publicKeyEncoding:{type:'pkcs1',format:'pem'}}).privateKey;
  const ssh=new Server({hostKeys:[key]},client=>{
    clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
    client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username==='fixture'&&ctx.password===password){authentications++;ctx.accept();}else ctx.reject(['password']);});
    client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('exec',(accept,_reject,info)=>{
      const stream=accept(),p=spawn('/bin/sh',['-c',info.command],{cwd:project,env:{...process.env,HOME:root}});processes.add(p);
      stream.pipe(p.stdin);p.stdin.on('error',()=>{});p.stdout.pipe(stream,{end:false});p.stderr.pipe(stream.stderr,{end:false});
      let open=true;
      p.on('exit',code=>{processes.delete(p);if(open&&!closing){stream.exit(code||0);stream.end();}});
      stream.on('close',()=>{open=false;if(p.exitCode===null)p.kill('SIGTERM');});
      client.once('close',()=>{open=false;});
    });}));
  });
  const api=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.method==='GET'&&req.url==='/v1/models')res.end(JSON.stringify({data:[{id:'fixture-model',max_model_len:32768}]}));else{inferences++;res.writeHead(500);res.end('{}');}});
  await new Promise(r=>ssh.listen(0,'127.0.0.1',r));await new Promise(r=>api.listen(0,'127.0.0.1',r));
  const bin=path.join(root,'.local/bin');fs.mkdirSync(bin,{recursive:true});
  fs.writeFileSync(path.join(bin,'ssh'),'#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o UserKnownHostsFile="$HARNESS_UI_HOME/known_hosts" "$@"\n',{mode:0o755});
  let child;
  try{
    const command=process.argv[2],args=[...process.argv.slice(3),'--ui-test'];if(!command)throw new Error('Pass Electron or the packaged executable');
    child=spawn(command,args,{stdio:'inherit',env:{...process.env,HARNESS_UI_HOME:root,HARNESS_UI_ENDPOINT:`http://127.0.0.1:${api.address().port}/v1`,HARNESS_UI_SSH_PORT:String(ssh.address().port),HARNESS_UI_PASSWORD:password,HARNESS_UI_PROJECT:project}});
    const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});clearTimeout(timer);
    if(code!==0)throw new Error('Desktop UI check exited '+code);
    if(!authentications)throw new Error('No real password SSH authentication was observed');
    if(inferences)throw new Error('UI test unexpectedly attempted model inference');
    console.log('PASS SSH fixture authenticated; zero model inference requests');
  }finally{
    closing=true;
    if(child&&child.exitCode===null)child.kill('SIGTERM');for(const p of processes)p.kill('SIGTERM');for(const c of clients)c.end();
    api.closeAllConnections();await new Promise(r=>api.close(r));await new Promise(r=>ssh.close(r));fs.rmSync(root,{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
