import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';

test('incoming is persisted, protected, and retained until explicit acknowledgement', async () => {
  const objects = new Map();
  const env = {MAILBOX_ADDRESS:'info@feel-y.com', BRIDGE_SECRET:'x'.repeat(48), MAIL_SPOOL:{
    async put(k,v){assert.ok(v instanceof ArrayBuffer); objects.set(k, await new Response(v).text());},
    async list(){return {objects:[...objects.keys()].map(key=>({key}))};},
    async get(k){return objects.has(k) ? {body:objects.get(k)} : null;},
    async delete(k){objects.delete(k);}
  }};
  await worker.email({to:'info@feel-y.com',rawSize:10,raw:'hello'},env);
  assert.equal(objects.size,1);
  assert.equal((await worker.fetch(new Request('https://worker/messages'),env)).status,401);
  const request = (path,method='GET') => new Request('https://worker'+path,{method,headers:{Authorization:'Bearer '+env.BRIDGE_SECRET}});
  const listing = await (await worker.fetch(request('/messages'),env)).json();
  const key = listing.keys[0];
  assert.equal(await (await worker.fetch(request('/messages/'+key),env)).text(),'hello');
  assert.equal(objects.size,1);
  assert.equal((await worker.fetch(request('/messages/'+key,'DELETE'),env)).status,204);
  assert.equal(objects.size,0);
  let rejected=false;
  await worker.email({to:'other@example.com',setReject(){rejected=true;}},env);
  assert.equal(rejected,true);
});

test('storage errors are propagated rather than silently accepting mail', async()=>{
  await assert.rejects(worker.email({to:'info@feel-y.com',rawSize:10,raw:'hello'},
    {MAILBOX_ADDRESS:'info@feel-y.com', MAIL_SPOOL:{async put(){throw new Error('storage unavailable');}}}));
});
