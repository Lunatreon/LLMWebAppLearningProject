const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const source=readFileSync('website/js/chat.js','utf8');
const functions=source.slice(source.indexOf('async function confirmTopic('),source.indexOf('function updateChatReviewNotice('));
function fixture(){
  const element=(value='')=>({value,disabled:false,focus(){}});
  const context=vm.createContext({state:{pendingTopic:{chat_id:'chat',topic:'Work',description:'Original',suggestion_id:'s1'},
    pendingMapSuggestion:{category:'own_perception',text:'Original',source_chat_id:'chat'}},
    topicTitle:element('Work'),topicDescription:element('Edited note'),topicTarget:element('target'),
    topicParent:element(),topicCategory:element('person'),topicEntryCategory:element('value'),
    topicConnections:{querySelectorAll(){return[]}},topicAccept:element(),topicDismiss:element(),
    mapSuggestionText:element('Edited observation'),mapSuggestionCategory:element('evidence'),mapSuggestionTarget:element('target'),
    mapSuggestionTargetField:{classList:{contains(){return false}}},mapSuggestionAccept:element(),mapSuggestionDismiss:element(),
    authHeaders(){return{}},hasMyMapAccess(){return true},async loadMap(){},async loadChats(){},renderMap(){},OVERALL_MAP_NODE_ID:'overall',
  });
  context.renderTopic=t=>{context.state.pendingTopic=t};
  context.renderMapSuggestion=t=>{context.state.pendingMapSuggestion=t};
  vm.runInContext(functions,context);return context;
}
test('failed attachment keeps suggestion and edits available for retry',async()=>{
  const c=fixture();c.api=async()=>{throw new Error('Offline')};
  await assert.rejects(c.confirmTopic(true),/Offline/);
  assert.equal(c.state.pendingTopic.suggestion_id,'s1');assert.equal(c.topicDescription.value,'Edited note');assert.equal(c.topicAccept.disabled,false);
  let request;c.api=async(p,o)=>{request=JSON.parse(o.body);return{profile:{}}};
  await c.confirmTopic(true);assert.equal(request.entry_category,'value');assert.equal(request.existing_topic_space_id,'target');assert.equal(request.suggestion_id,'s1');
  assert.equal(c.state.pendingTopic,null);
});
test('map note uses selected category and remains available on failure',async()=>{
  const c=fixture();c.api=async()=>{throw new Error('Offline')};
  await assert.rejects(c.confirmMapSuggestion(true),/Offline/);assert.ok(c.state.pendingMapSuggestion);
  let request;c.api=async(p,o)=>{request=JSON.parse(o.body);return{map:{topic_spaces:[]}}};
  await c.confirmMapSuggestion(true);assert.equal(request.category,'evidence');assert.equal(request.topic_space_id,'target');assert.equal(c.state.pendingMapSuggestion,null);
});
test('double click cannot submit the same topic twice while saving',async()=>{
  const c=fixture();let release,calls=0;c.api=()=>{calls++;return new Promise(r=>{release=r})};
  const pending=c.confirmTopic(true);await c.confirmTopic(true);assert.equal(calls,1);release({profile:{}});await pending;
});
test('saved topic is selected and no longer hidden by a category filter',async()=>{
  const c=fixture();c.state.mapFilter='person';
  c.api=async()=>({saved_topic_space_id:'new-topic',profile:{self_authorship_map:{topic_spaces:[]}}});
  await c.confirmTopic(true);
  assert.equal(c.state.mapFilter,'all');
  assert.equal(c.state.activeMapNodeId,'new-topic');
  assert.equal(c.state.mapDetailOpen,true);
});
