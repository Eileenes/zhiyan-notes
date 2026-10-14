// Exercise recording lifecycle failures without opening the user's microphone.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function runtime(failOnce=false) {
  let stops=0,writes=0,last,recorder;
  class Recorder {
    static isTypeSupported(mime){return mime==='audio/webm';}
    constructor(){this.state='inactive';this.mimeType='audio/webm';recorder=this;}
    start(){this.state='recording';}
    stop(){this.state='inactive';setTimeout(()=>{this.ondataavailable?.({data:new Blob(['final-audio-chunk'])});this.onstop?.();},5);}
  }
  const scope={window:{__TAURI_INTERNALS__:{invoke:async(_,args)=>{
    const m=args.message;
    if(m.op==='prefsGet')return {};
    if(m.op==='mediaWrite'){writes++;last=m;if(failOnce&&writes===1)throw new Error('disk full');return {path:'/isolated/voice.webm'};}
    return true;
  }}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stops++;}}]})}},MediaRecorder:Recorder,
  AudioContext:class{createAnalyser(){return {fftSize:2,getByteTimeDomainData(a){a.fill(128);}};}createMediaStreamSource(){return {connect(){}};}close(){}},Blob,Uint8Array,Date,Promise,Error,JSON,Math,String,btoa,setTimeout};
  vm.runInNewContext(fs.readFileSync(__dirname+'/runtime.js','utf8'),scope);
  return {call:m=>scope.window.zyNative.call(m),recorder:()=>recorder,stats:()=>({stops,writes,last})};
}
test('stop waits for final recorded chunk before storing and releases microphone',async()=>{
 const app=runtime();await app.call({op:'recStart'});const r=await app.call({op:'recStop'});
 assert.equal(r.path,'/isolated/voice.webm');assert.equal(atob(app.stats().last.data),'final-audio-chunk');assert.equal(app.stats().stops,1);
});
test('interrupted recording and failed disk write remain retryable',async()=>{
 const app=runtime(true);await app.call({op:'recStart'});app.recorder().stop();
 await assert.rejects(app.call({op:'recStop'}),/disk full/);
 assert.equal((await app.call({op:'recStop'})).path,'/isolated/voice.webm');assert.equal(app.stats().writes,2);assert.equal(app.stats().stops,1);
});
test('cancelling discards chunks and releases the microphone without writing',async()=>{
 const app=runtime();await app.call({op:'recStart'});await app.call({op:'recCancel'});
 assert.equal(app.stats().writes,0);assert.equal(app.stats().stops,1);
 await assert.rejects(app.call({op:'recStop'}),/没有可以保存/);
});
