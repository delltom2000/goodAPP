const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const now = Date.now(), t = Math.floor(now / 300000) * 300000;
const bars = [[t-300000, '900', '920', '890', '910', '10'], [t, '910', '930', '900', '920', '20']];
const gate = bars.map(r => [String(r[0]/1000), '10000', r[4], r[2], r[3], r[1], r[5]]).reverse();
const fail = () => { throw new Error('network unavailable'); };
function app(resolve = fail, storage = new Map()) {
  const calls = [];
  const c = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, console,
    localStorage: {getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
    fetch: async (url, options) => { calls.push(url); const body = await resolve(url, options); return {ok:true,json:async()=>body}; }
  });
  for (const file of ['config.js','history.js','history-chart.js']) vm.runInContext(fs.readFileSync(path.join(root,'js',file),'utf8'),c);
  return { calls, storage, history: vm.runInContext('History',c), indicators: vm.runInContext('HistoryChart',c) };
}
const coin = {base:'ZEC',price:920,src:{binance:{},gate:{}}};
test('Binance primary outage falls back to official data host', async()=>{
 const a=app(url=>url.includes('data-api.binance.vision')?bars:fail());
 const r=await a.history.load(coin,'time','binance'); assert.equal(r.points.length,2);assert.equal(r.host,'data-api.binance.vision');assert.equal(r.points[1].c,920);
});
test('total Binance outage still finds Gate and normalizes OHLCV/seconds/order', async()=>{
 const a=app(url=>url.includes('gateio.ws')?gate:fail());const r=await a.history.load(coin);
 assert.equal(r.source,'gate');assert.equal(r.points[0].t,t-300000);assert.equal(r.points[0].o,900);assert.equal(r.points[1].v,20);
});
test('persistent cache survives reload and complete outage, without relabeling as live', async()=>{
 const a=app(()=>gate);const live=await a.history.load(coin,'time','gate');
 const offline=app(fail,a.storage); const r=await offline.history.load(coin,'time','auto',true);
 assert.equal(r.cached,true);assert.equal(r.stale,true);assert.equal(r.fetchedAt,live.fetchedAt);assert.equal(r.source,'gate');assert.equal(r.points.length,2);
 assert.equal(await offline.history.peek('BTC','time'),null);
});
test('cache keys separate coins and periods; cold outage never fabricates candles',async()=>{
 const a=app(url=>url.includes('gateio.ws')?gate:fail()); await a.history.load(coin,'time','gate');
 assert.equal(a.history.peek('ZEC','day'),null);assert.equal(a.history.peek('BTC','time'),null);
 const r=await a.history.load(coin,'day','binance');assert.equal(r.unavailable,true);assert.equal(r.points.length,0);
});
test('manual source failure preserves the original cached provenance',async()=>{
 const a=app(url=>url.includes('gateio.ws')?gate:fail());await a.history.load(coin,'time','gate');
 const r=await a.history.load(coin,'time','bybit',true);assert.equal(r.source,'gate');assert.equal(r.requestedSource,'bybit');assert.equal(r.cached,true);
});
test('old remote data cannot replace a newer saved history',async()=>{
 const a=app(()=>gate);const first=await a.history.load(coin,'time','gate');
 const old=gate.map(r=>[String(+r[0]-86400),...r.slice(1)]);const b=app(()=>old,a.storage);
 const r=await b.history.load(coin,'time','gate',true);assert.equal(r.asOf,first.asOf);assert.equal(r.cached,true);
});
test('old remote data is usable when no cache exists, and marked stale',async()=>{
 const old=gate.map(r=>[String(+r[0]-86400),...r.slice(1)]);const a=app(()=>old);
 const r=await a.history.load(coin,'time','gate');assert.equal(r.stale,true);assert.equal(r.cached,false);assert.equal(r.points.length,2);
});
test('normalization rejects invalid OHLCV and deduplicates timestamps',()=>{
 const a=app();const r=a.history.normalize([...bars,bars[0],[t,900,800,950,920,10],[t+1,900,930,890,920,-1]],'binance');assert.equal(r.length,2);
});
test('KuCoin and HTX layouts preserve close/volume and chronological order',()=>{
 const a=app();const k=a.history.normalize(bars.map(r=>[r[0]/1000,r[1],r[4],r[2],r[3],r[5]]).reverse(),'kucoin');assert.equal(k[1].c,920);
 const h=a.history.normalize([{id:t/1000,open:910,high:930,low:900,close:920,amount:20}],'htx');assert.equal(h[0].v,20);assert.equal(h[0].t,t);
});
test('calendar monthly aggregation discards incomplete first month and sums base volume',()=>{
 const a=app();const p=(d,c)=>({t:Date.parse(d),o:c,h:c+2,l:c-2,c:c+1,v:10});
 const r=a.history.months([p('2026-01-15',90),p('2026-02-01',100),p('2026-02-02',110),p('2026-03-01',120)]);
 assert.equal(r.length,2);assert.equal(r[0].o,100);assert.equal(r[0].c,111);assert.equal(r[0].v,20);
});
test('additional source with a wildly different price is rejected',async()=>{
 const a=app(()=>({code:'00000',data:bars.map(r=>[r[0],1,2,.5,1,10])}));const r=await a.history.load(coin,'time','bitget');assert.equal(r.unavailable,true);assert.match(r.errors[0].error,/identity/);
});
test('simultaneous duplicate requests are coalesced',async()=>{
 const a=app(()=>gate);const [x,y]=await Promise.all([a.history.load(coin,'time','gate'),a.history.load(coin,'time','gate')]);assert.equal(a.calls.length,1);assert.equal(x,y);
});
test('indicator reference values: MA5, flat RSI, constant MACD',()=>{
 const a=app();const rows=Array.from({length:35},(_,i)=>({c:100}));assert.equal(a.indicators.ma(rows,5)[4],100);assert.equal(a.indicators.rsi(rows)[14],50);assert.equal(a.indicators.macd(rows).hist[34],0);
 assert.equal(a.indicators.ma([{c:1},{c:2},{c:3},{c:4},{c:5}],5)[4],3);
});
test('corrupt persistent cache is ignored and does not prevent saving new data',async()=>{
 const storage=new Map([['cp.history.v2','"corrupt"']]);const a=app(()=>gate,storage);const r=await a.history.load(coin,'time','gate');assert.equal(r.points.length,2);assert.equal(a.history.peek('ZEC','time').points.length,2);
});
test('API error payload is recorded with its actual rejection reason',async()=>{
 const a=app(()=>({retCode:10001,retMsg:'symbol not found'}));const r=await a.history.load(coin,'time','bybit');assert.equal(r.unavailable,true);assert.match(r.errors[0].error,/10001: symbol not found/);
});
