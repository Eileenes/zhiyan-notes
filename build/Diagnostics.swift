import Foundation

// Debug-only: Release builds exclude this file (apple/project.yml
// EXCLUDED_SOURCE_FILE_NAMES) and build.sh adds it only with ZY_DIAGNOSTICS=1.
// The guard keeps it inert even if it is ever compiled into a non-Debug build.
#if DEBUG

/// 自拍前的真实交互脚本。
/// 目的不是「造出」某种界面，而是验证壳里 JS 真的能跑、事件真的绑上了。
func actionScript(_ name: String) -> String? {
  switch name {
  case "garden-test":
    guard let database = Options.parse().databasePath else { return nil }
    let fixture = URL(fileURLWithPath: database).deletingLastPathComponent().appendingPathComponent(
      "media/test-tone.wav"
    ).path
    let encoded = String(
      data: try! JSONSerialization.data(withJSONObject: [fixture]), encoding: .utf8)!
    return """
      (async function() {
        const call = window.zyNative.call, lines = []; let pass = 0, fail = 0;
        const check = (name, value) => { lines.push((value ? 'PASS ' : 'FAIL ') + name); value ? pass++ : fail++; };
        const wait = async predicate => { for(let i=0; i<100; i++){if(predicate())return;await new Promise(r=>setTimeout(r,30));}throw new Error('UI timeout'); };
        try {
          await wait(()=>state.loaded);
          state.draft = '花园回归：记下一朵小花'; render();
          document.querySelector('[data-act="save-text"]').click();
          await wait(()=>!state.busy);
          check('原生 UI 保存并留在首页', state.page==='capture' && !state.draft && ZY.list.some(n=>n.raw.includes('花园回归')));
          const note = ZY.list.find(n=>n.raw.includes('花园回归'));
          await openMemory(note.id);
          document.querySelector('[data-act="edit"]').click();
          state.edit.text='上海的花园'; state.edit.tags='旅行，花园';
          await saveEdit();
          check('原生编辑与标签落库', state.note.raw==='上海的花园' && state.note.tags.includes('旅行'));
          await call({op:'delete',id:note.id});
          check('原生删除不再命中', (await call({op:'search',q:'上海的花园'})).count===0);
          await call({op:'restore',id:note.id});
          check('原生撤销恢复检索', (await call({op:'search',q:'上海的花园'})).count===1);
          await call({op:'prefsSet',key:'draft',value:'原生重启草稿测试'});
          const fixture=\(encoded)[0];
          const audio=await ZY.save('测试声音',{id:'garden-audio-fixture',source:'voice',audio:fixture,dur:2000,state:'done'});
          check('录音时长毫秒保存、秒数展示', (await ZY.get(audio.id)).dur===2);
          await openMemory(audio.id);
          document.querySelector('[data-act="play"]').click();
          let playing={};
          for(let i=0;i<50;i++){playing=await call({op:'audioStatus'});if(playing.playing&&playing.seconds>0)break;await new Promise(r=>setTimeout(r,100));}
          lines.push('INFO playback='+JSON.stringify(playing));
          check('真实音频播放时间推进', playing.playing && playing.seconds>0);
          const paused=await call({op:'audioPause'});
          check('暂停真实播放器', !paused.playing);
          const sought=await call({op:'audioSeek',seconds:1});
          check('音频跳转到指定时间', Math.abs(sought.seconds-1)<0.1);
          await call({op:'audioStop'});
          check('停止后释放播放器', (await call({op:'audioStatus'})).id==='');
        } catch(error) { fail++; lines.push('FAIL '+error.message); }
        await call({op:'log',lines,pass,fail});
      })(); 'garden-test-started';
      """
  case "services-test":
    return """
      (async function(){
        const call=window.zyNative.call,lines=[];let pass=0,fail=0;
        const check=(name,value)=>{lines.push((value?'PASS ':'FAIL ')+name);value?pass++:fail++;};
        try{
          for(let i=0;i<100&&!Services.ready;i++)await new Promise(r=>setTimeout(r,30));
          navigate('settings');document.querySelector('[data-p="providers"]').click();
          check('模型配置入口可进入',state.page==='providers');
          Services.newProvider();
          check('四种协议可选择',document.querySelectorAll('[data-provider-field="protocol"] option, #protocol-options [role="option"]').length===4);
          if(state.platform!=='ios'){
            document.querySelector('#provider-protocol').click();
            check('Mac 应用内展开协议菜单',!document.querySelector('#protocol-options').hidden&&!document.querySelector('select[data-provider-field="protocol"]'));
            document.querySelector('#protocol-options [data-value="anthropic"]').click();
            check('Mac 协议选择写入草稿',Services.providerDraft.protocol==='anthropic'&&document.querySelector('#protocol-options').hidden);
          }
          check('API Key 为密码输入',document.querySelector('#provider-key').type==='password');
          Services.providerDraft={id:'native-fixture',name:'原生配置验证',protocol:'anthropic',baseUrl:'https://example.com/v1',model:'custom-model',enabled:true};
          Services.providerKey='isolated-fixture-key';await Services.providerAction(false);
          check('自定义模型配置已保存',Services.providers.some(p=>p.id==='native-fixture'&&p.protocol==='anthropic'));
          check('系统安全存储读回',await call({op:'secretGet',key:'provider.native-fixture'})==='isolated-fixture-key');
          check('配置元数据不含密钥',!JSON.stringify(await call({op:'servicesGet'})).includes('isolated-fixture-key'));
          navigate('sync');check('账号同步入口可进入',!!document.querySelector('[data-account-field="url"]'));
          await Services.removeProvider('native-fixture');
          check('移除配置同时清除密钥',await call({op:'secretGet',key:'provider.native-fixture'})==='');
          check('服务页无横向溢出',document.querySelector('.services-page').scrollWidth<=innerWidth);
        }catch(e){fail++;lines.push('FAIL '+e.message);}
        await call({op:'log',lines,pass,fail});
      })(); 'services-test-started';
      """
  case "providers-view":
    return "navigate('providers');Services.newProvider();'ok';"
  case "protocol-view":
    return "navigate('providers');Services.newProvider();document.querySelector('#provider-protocol')?.click();'ok';"
  case "gateway-view":
    return "navigate('integrations');JSON.stringify(Array.from(document.querySelectorAll('.sidebar [data-act=nav]')).map(b=>({page:b.dataset.p,active:b.classList.contains('on'),color:getComputedStyle(b).backgroundColor})));"
  case "gateway-test":
    return """
      (async function(){
        const call=window.zyNative.call,lines=[];let pass=0,fail=0;
        const check=(name,value)=>{lines.push((value?'PASS ':'FAIL ')+name);value?pass++:fail++;};
        try{
          for(let i=0;i<100&&!ExternalAPI.ready;i++)await new Promise(r=>setTimeout(r,30));
          navigate('settings');document.querySelector('[data-p="integrations"]').click();
          check('设置内可进入对外接口',state.page==='integrations');
          check('对外接口保持设置导航选中',document.querySelector('.sidebar [aria-current="page"], .ios-tab[aria-current="page"]')?.dataset.p==='settings');
          if(state.platform==='ios'){
            check('手机提示使用桌面端托管',document.querySelector('[data-gateway="start"]').disabled);
          }else{
            ExternalAPI.config.port=24000+Math.floor(Math.random()*10000);
            await ExternalAPI.control('start');
            check('应用内启动真实接口',ExternalAPI.status.running===true);
            check('默认只读',ExternalAPI.status.config.allow_write===false);
            check('运行时配置锁定',document.querySelector('#gateway-port').disabled);
            const first=await call({op:'gatewayKey'});
            check('访问密钥已保存安全存储',first.length>32 && await call({op:'secretGet',key:'gateway.access'})===first);
            check('界面及状态不暴露密钥',!document.body.textContent.includes(first)&&!JSON.stringify(await call({op:'gatewayStatus'})).includes(first));
            await ExternalAPI.control('rotate');
            const next=await call({op:'gatewayKey'});
            check('重置密钥并保持运行',next!==first && ExternalAPI.status.running);
            await ExternalAPI.control('stop');
            check('停止并恢复可配置',!ExternalAPI.status.running&&!document.querySelector('#gateway-port').disabled);
            const button=document.querySelector('[data-field="allow_write"]');button.click();
            check('已有风格开关可修改写入权限',ExternalAPI.config.allow_write && button.getAttribute('aria-checked')==='true');
            await call({op:'secretDelete',key:'gateway.access'});
          }
        }catch(e){fail++;lines.push('FAIL '+e.message);}
        try{await call({op:'gatewayStop'});}catch{}
        await call({op:'log',lines,pass,fail});
      })(); 'gateway-test-started';
      """
  case "sync-view":
    return "navigate('sync');'ok';"
  case "draft-check":
    return """
      (async function(){
        const ok=state.draft==='原生重启草稿测试';
        await window.zyNative.call({op:'log',lines:[(ok?'PASS ':'FAIL ')+'重启恢复原生草稿'],pass:ok?1:0,fail:ok?0:1});
      })(); 'draft-check-started';
      """
  case "export-check":
    return """
      (async function(){
        const call=window.zyNative.call;
        try {
          const result=await call({op:'export',format:'md'});
          const ok=!!result.path;
          await call({op:'log',lines:[(ok?'PASS ':'FAIL ')+'导出文件并打开系统分享'],pass:ok?1:0,fail:ok?0:1});
        } catch(error) {
          await call({op:'log',lines:['FAIL '+error.message],pass:0,fail:1});
        }
      })(); 'export-check-started';
      """
  case "mic":
    return "document.querySelector('.btn-mic').click(); 'ok';"
  case "ob":
    return """
      var b = document.querySelector('[data-act="ob-start"]') || document.querySelector('[data-act="ob-close"]');
      if (b) b.click(); 'ok';
      """
  case "capture":
    return """
      var b = document.querySelector('[data-act="ob-start"]') || document.querySelector('[data-act="ob-close"]');
      if (b) b.click();
      var it = document.querySelectorAll('.cap-item');
      if (it.length) it[2].click();
      'ok';
      """
  case "search", "search2":
    // 2 字查询：trigram 失效，全靠 unigram 兜底，这条专门验它
    //
    // ⚠️ 必须整体包在 IIFE 里。evaluateJavaScript 不接受**顶层 return**
    //    （会当成 SyntaxError，报出来的是「发生了JavaScript异常」这种毫无信息量的文案）。
    //    之前踩过一次：为了加诊断写了 `if (!q) return 'ERR:...'`，结果脚本直接语法错误，
    //    反而把真正的空指针给掩盖了。
    let term = (name == "search") ? "包子" : "咖啡"
    return """
      (function () {
        var n = document.querySelector('[data-p="search"]');
        if (!n) return 'ERR:no-nav';
        n.click();
        var q = document.getElementById('q');
        if (!q) return 'ERR:no-input-after-click';
        // 只赋值 + 派发 input，**不** focus。
        // 加上 focus() 会拉起软键盘，iOS 把可视视口压到 377px、页面放大 6.7%，
        // 截图里表现为整页横向被切掉一半 —— 那是键盘行为，不是版式缺陷，
        // 用它做版式验证会得到误导性的结论。
        q.value = '\(term)';
        q.dispatchEvent(new Event('input', {bubbles:true}));
        return 'typed:' + q.value;
      })();
      """
  case "settings":
    return "document.querySelector('[data-p=\"settings\"]').click(); 'ok';"
  case "sync":
    return """
      document.querySelector('[data-p="settings"]').click();
      document.querySelector('.row-stacked[data-p="sync"]').click();
      'ok';
      """
  case "rectest":
    // iOS 录音链路端到端自检：真录 2 秒 → 停止 → 落库 → 检查文件真的有内容。
    // 录音是核心功能，但在模拟器上有三处未知：能不能录、权限弹窗怎么办、
    // 文件是不是真落盘。没验过就等于没实现。
    // 权限用 `xcrun simctl privacy <udid> grant microphone <bundleid>` 预授，
    // 否则系统弹窗程序化点不掉。
    return """
      (function () {
        var call = window.zyNative.call;
        var out = [];
        var ck = function (n, got, want) {
          var ok = got === want;
          out.push((ok ? 'PASS ' : 'FAIL ') + n + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
        };
        (async function () {
         // 全程 try/catch：之前这里任何一步 reject 都会让整条链静默中断，
         // 结果就是「命令跑了、什么都没输出」，根本分不清是没录到还是没跑到
         try {
          var perm = await call({ op: 'micPerm' });
          out.push('INFO 麦克风权限=' + perm);
          var st = await call({ op: 'recStart' });
          out.push('INFO recStart → ' + JSON.stringify(st));
          await new Promise(function (r) { setTimeout(r, 2000); });
          var sp = await call({ op: 'recStop' });
          out.push('INFO recStop → ' + JSON.stringify(sp));
          ck('录音时长 > 1 秒', sp.dur > 1000, true);
          ck('返回了文件路径', typeof sp.path === 'string' && sp.path.length > 0, true);

          var id = await call({ op: 'save', text: '', source: 'voice',
                                audio: sp.path, dur: sp.dur, state: 'pending' });
          out.push('INFO 落库 id=' + id.id);

          var all = await call({ op: 'load' });
          var hit = (all.notes || []).filter(function (n) { return n.id === id.id; })[0];
          ck('语音记录已入库', !!hit, true);
          ck('入库带音频路径', !!(hit && hit.audio), true);
          ck('状态为待转写', hit && hit.state === 'pending', true);

          var ex = await call({ op: 'export', format: 'json', reveal: false });
          out.push('INFO 导出 → ' + ex.path);
          // 导出目录按平台不同：iOS 在 Documents（用户能在「文件」App 里看到），
          // macOS 在 Application Support（不该往桌面丢文件，用户自己挑地方导出更合适）
          var wantDir = '/Application Support/';
          var win = document.querySelector('body').className.indexOf('ios') >= 0;
          if (win) { wantDir = '/Documents/'; }
          ck('导出落在预期目录 ' + wantDir, ex.path.indexOf(wantDir) > 0, true);
          out.push('INFO 导出实际路径 ' + ex.path);

          var pass = out.filter(function (l) { return l.indexOf('PASS') === 0; }).length;
          var fail = out.filter(function (l) { return l.indexOf('FAIL') === 0; }).length;
          await call({ op: 'log', lines: out, pass: pass, fail: fail });
         } catch (e) {
          out.push('FAIL 异常: ' + (e && e.message ? e.message : String(e)));
          await call({ op: 'log', lines: out, pass: 0, fail: 1 });
         }
        })();
        return 'rectest-started';
      })();
      """
  case "probe":
    // iOS 横向被切：找出比可视视口宽的元素。
    // 已知 clientWidth=402 但 visualViewport.width=377，iOS 于是把页面放大到 1.067
    // 并横向平移，左半边被推出画面。这里把比 vv 宽的元素逐个报出来。
    return """
      (function () {
        setTimeout(function () {
          var vv = window.visualViewport, vw = vv ? vv.width : innerWidth;
          var d = document.documentElement;
          var out = ['vv=' + Math.round(vw) + ' client=' + d.clientWidth +
                     ' scroll=' + d.scrollWidth + ' inner=' + innerWidth,
                     'vvOffsetLeft=' + Math.round(vv.offsetLeft)];
          document.querySelectorAll('body *').forEach(function (e) {
            var r = e.getBoundingClientRect();
            if (r.width <= vw + 1) return;
            var cs = getComputedStyle(e);
            out.push('WIDE ' + e.tagName + '.' +
                     (typeof e.className === 'string' ? e.className : 'svg') +
                     ' w=' + Math.round(r.width) + ' left=' + Math.round(r.left) +
                     ' pos=' + cs.position + ' overflowX=' + cs.overflowX);
          });
          if (out.length === 2) out.push('（没有单元素比 vv 宽 → 是根节点/缩放层的问题）');
          window.zyNative.call({ op: 'dump', lines: out.slice(0, 40) });
        }, 6000);
        return 'probe-armed';
      })();
      """
  case "selftest":
    // 端到端自检：在页面里真调原生桥接，断言落库 / 中文检索 / 导出。
    // 每一条都直接打回 stderr，失败时壳以退出码 3 结束，构建脚本据此判定。
    return """
      (async function () {
        const L = []; let pass = 0, fail = 0;
        const ck = (name, got, want) => {
          const ok = got === want;
          ok ? pass++ : fail++;
          L.push((ok ? 'PASS ' : 'FAIL ') + name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
        };
        const call = window.zyNative.call;
        if (!call) { L.push('FAIL 桥接未注入'); call({ op: 'log', lines: L, pass: 0, fail: 1 }); return; }

        await call({ op: 'wipe' });
        const saved = await call({ op: 'save', text: '小区口包子店租金要翻倍，老板大概撑不过这个冬天', source: 'text', tags: ['早餐店'], state: 'done' });
        await call({ op: 'save', text: '跟李彦在望京SOHO楼下那家云南米线聊了二十分钟', source: 'voice', tags: ['李彦'], state: 'done' });
        await call({ op: 'save', text: '今天下雨了，地铁站里全是伞', source: 'text', state: 'done' });
        L.push('INFO 写入完成 id=' + saved.id);

        const all = await call({ op: 'load' });
        ck('落库条数', (all.notes || []).length, 3);

        // 2 字与 1 字：trigram 失效、全靠 unigram 的路径
        ck('搜 包子 (2字)', (await call({ op: 'search', q: '包子' })).count, 1);
        ck('搜 李彦 (2字)', (await call({ op: 'search', q: '李彦' })).count, 1);
        ck('搜 雨   (1字)', (await call({ op: 'search', q: '雨' })).count, 1);
        ck('搜 咖啡 (无此词)', (await call({ op: 'search', q: '咖啡' })).count, 0);
        // 3 字与西文：trigram 路径
        ck('搜 包子店 (3字)', (await call({ op: 'search', q: '包子店' })).count, 1);
        ck('搜 SOHO (西文)', (await call({ op: 'search', q: 'SOHO' })).count, 1);
        // 标签也要能搜到（unigram 必须覆盖 tags，否则漏一半）
        ck('搜标签 早餐店', (await call({ op: 'search', q: '早餐店' })).count, 1);
        // 多词 AND
        ck('搜 李彦 米线 (AND)', (await call({ op: 'search', q: '李彦 米线' })).count, 1);
        ck('搜 李彦 包子 (AND 不该命中)', (await call({ op: 'search', q: '李彦 包子' })).count, 0);

        const st = await call({ op: 'stats' });
        ck('统计条数', st.total, 3);

        const ex = await call({ op: 'export', format: 'json', reveal: false });
        L.push('INFO 导出路径 ' + ex.path);

        await call({ op: 'log', lines: L, pass: pass, fail: fail });
        return 'done';
      })(); 'selftest-started';
      """
  default:
    return nil
  }
}

// MARK: - 资源定位

/// 加载目标：页面 URL + 读权限目录。
/// 这两个必须分开：pageURL 上可能挂了 ?plat=ios / ?theme=…，
/// 而 allowingReadAccessTo 要的是干净的目录 URL（带 query 的目录会让读权限判断失效）。

#endif
