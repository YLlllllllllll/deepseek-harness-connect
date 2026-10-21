const $=id=>document.getElementById(id);
let profiles=[],editing='',busy=false;
function message(text,error=false){$('status').textContent=text;$('status').className=error?'error':'';}
async function request(method,args){const value=await window.remoteServers.request(method,args);if(!value?.ok)throw new Error(value?.error||'操作失败');return value;}
async function action(fn){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){message(e.message,true);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
function auth(){ $('password-row').hidden=$('auth').value!=='password';$('key-row').hidden=$('auth').value!=='key';}
function reset(){editing='';$('server-form').reset();$('form-title').textContent='添加服务器';auth();}
function edit(profile){editing=profile.id;for(const key of ['name','host','port','user','keyPath','remoteRoot','proxyJump'])$(key).value=profile[key]??'';$('auth').value=profile.authMethod;$('password').value='';$('form-title').textContent='编辑服务器';auth();window.scrollTo(0,0);}
async function reload(){const result=await request('listProfiles');profiles=result.profiles||[];render();}
function render(){const root=$('servers');root.replaceChildren();if(!profiles.length){root.textContent='暂无服务器，请在上方添加。';return;}
  for(const p of profiles){const card=document.createElement('div');card.className='card';card.dataset.profile=p.id;
    const title=document.createElement('strong');title.textContent=p.name||p.host;card.append(title);
    const detail=document.createElement('p');detail.textContent=`${p.user}@${p.host}:${p.port} · ${p.authMethod==='password'?'密码':'私钥 / SSH agent'}`;card.append(detail);
    const path=document.createElement('input');path.value=p.remoteRoot||'~';path.setAttribute('aria-label','远程项目目录');card.append(path);
    const buttons=document.createElement('div');buttons.className='actions';card.append(buttons);
    const button=(label,type,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.action=type;b.onclick=()=>action(fn);buttons.append(b);};
    button('测试连接','test',async()=>{message('正在测试连接…');const r=await request('testConnection',{id:p.id});message('连接成功'+(r.warning?'\n'+r.warning:''));});
    button('添加远程工作区','workspace',async()=>{const remotePath=path.value.trim();if(!remotePath)throw new Error('请输入远程项目目录');message('正在验证远程目录…');await request('listDir',{profileId:p.id,path:remotePath});await request('createRemoteWorkspace',{profileId:p.id,remotePath});message('工作区已添加，请在主窗口左侧选择该项目。');});
    button('编辑','edit',async()=>edit(p));
    root.append(card);
  }
}
$('auth').onchange=auth;$('new-connection').onclick=reset;
$('server-form').onsubmit=event=>{event.preventDefault();action(async()=>{const port=Number($('port').value);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('端口范围为 1–65535');
  const data={name:$('name').value.trim(),host:$('host').value.trim(),port,user:$('user').value.trim(),authMethod:$('auth').value,password:$('password').value,keyPath:$('keyPath').value.trim(),remoteRoot:$('remoteRoot').value.trim()||'~',proxyJump:$('proxyJump').value.trim()};
  if(!data.host||!data.user)throw new Error('SSH 地址和用户名不能为空');if(editing)data.id=editing;
  await request('saveProfile',data);reset();await reload();message('服务器已保存，可以测试连接或添加远程工作区。');
});};
reload().catch(e=>message(e.message,true));auth();
