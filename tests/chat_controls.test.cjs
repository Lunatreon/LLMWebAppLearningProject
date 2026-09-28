const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  let finish, calls = 0, rendered = [];
  const state = {activeChatId:'a', token:'token', chats:[{chat_id:'a',messages:[]},{chat_id:'b',messages:[]}]};
  const button = {disabled:false,classList:{toggle(){}},setAttribute(){}};
  const context = vm.createContext({state, AbortController, ApiError:Error,
    messageInput:{value:'hello'}, sendButton:button, autoresizeMessageInput(){},
    authHeaders(){return {};}, chatTitle:{}, document:{},
    apiStream:async (path, options, callback) => {
      calls++;
      await new Promise((resolve,reject) => {
        finish = () => {callback({type:'result',data:{chat_id:'a',chat_info:{title:'A',messages:[{role:'assistant',content:'reply'}]}}});resolve();};
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    },
  });
  vm.runInContext(fs.readFileSync('website/js/chat.js','utf8'),context);
  context.autoresizeMessageInput = () => {};
  context.renderMessages = items => rendered.push(items);
  context.renderChats = context.renderMapSuggestion = context.renderTopic = context.pollTopicSoon = context.renderInlineError = () => {};
  return {context,state,button,finish:()=>finish(),calls:()=>calls,rendered};
}
test('finishing an earlier conversation does not navigate or render over another chat',async()=>{
  const f=fixture();
  const promise=f.context.sendMessage({preventDefault(){}});
  f.state.activeChatId='b';
  f.finish(); await promise;
  assert.equal(f.state.activeChatId,'b');
  assert.equal(f.state.chats.find(c=>c.chat_id==='a').messages[0].content,'reply');
  assert.equal(f.rendered.length,1);
  assert.equal(f.state.chatRequest,null);
});
test('stop aborts the current request without submitting another message',async()=>{
  const f=fixture();
  const promise=f.context.sendMessage({preventDefault(){}});
  f.context.messageInput.value='new draft';
  await f.context.sendMessage({preventDefault(){}});
  await promise;
  assert.equal(f.calls(),1);
  assert.equal(f.context.messageInput.value,'new draft');
  assert.equal(f.state.chatRequest,null);
  assert.equal(f.button.disabled,false);
});
test('returning to a running reply restores the waiting bubble and stop control',()=>{
  const f=fixture(); let waiting=0, users=0;
  f.state.chatRequest={chatId:'a',context:'hello',text:''};
  f.context.messages={querySelector(){return null;},append(){users++;}};
  f.context.document={createElement(){return {};}};
  f.context.showWaitingMessage=()=>{waiting++;return {};};
  f.context.createChatTextPlayer=()=>({});
  f.context.restoreActiveReply();
  assert.equal(waiting,1); assert.equal(users,1);
  assert.equal(f.button.title,'Stop response');
  f.state.activeChatId='b'; f.context.restoreActiveReply();
  assert.equal(waiting,1); assert.equal(f.button.disabled,true);
});
