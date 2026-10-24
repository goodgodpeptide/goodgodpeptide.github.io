import assert from "node:assert/strict";
import test from "node:test";
import { buildModelInputReview } from "../model_input_review.js";
import { buildModelReviewText, installScheduleComparison, modelReviewTargets } from "../schedule_comparison_ui.js";

const H = 3_600_000, D = 24 * H;
const NOW = Date.parse("2030-01-01T12:00:00+09:00");
const PLANNED = Date.parse("2030-01-03T12:00:00+09:00");
const A = "Tirzepatide 공개예시", B = "Retatrutide 공개예시";
const pk = (dose, elapsed) => elapsed < 0 ? 0 : dose * (Math.exp(-elapsed / 120) - Math.exp(-elapsed / 4));

class E {
  constructor(tag, doc) { this.tagName=tag.toUpperCase(); this.doc=doc; this.listeners={}; this.style={}; this.dataset={}; this.hidden=false; this.value=""; this.textContent=""; this.classList={contains:()=>false}; }
  set id(v){ this._id=v; if(v)this.doc.nodes.set(v,this); } get id(){return this._id||"";}
  set innerHTML(v){ this._html=v; for(const m of v.matchAll(/<(select|input|button|div|canvas|tbody)[^>]*id="([^"]+)"[^>]*>/g)){const n=new E(m[1],this.doc);n.id=m[2];if(m[2]==="sc-next")n.value="original";} const d=this.doc.getElementById("sc-drug"),o=v.match(/<option value="([^"]+)">/);if(d&&o)d.value=o[1]; }
  get innerHTML(){return this._html||"";} addEventListener(t,f){(this.listeners[t]??=[]).push(f);} dispatch(t){for(const f of this.listeners[t]||[])f({target:this});}
  click(){this.clicked=true;this.dispatch("click");} appendChild(){} insertAdjacentElement(){} getBoundingClientRect(){return{width:600};}
  getContext(){return{setTransform(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},setLineDash(){}};}
}
class Observer { constructor(cb){this.cb=cb;} observe(){} }
function setup({ contribution=pk }={}) {
  const nodes=new Map(), links=[], blobs=[], urls=[];
  const doc={nodes,body:{classList:{contains:()=>false}},documentElement:{dataset:{}},defaultView:{MutationObserver:Observer},
    getElementById:id=>nodes.get(id)||null,createElement(tag){const e=new E(tag,this);if(tag==="a")links.push(e);return e;},head:null};
  doc.head=new E("head",doc); const anchor=new E("div",doc);anchor.id="remaining-cards";
  const win={devicePixelRatio:1,MutationObserver:Observer,addEventListener(){},Blob:class extends Blob{constructor(parts,opt){super(parts,opt);blobs.push(this);}},
    URL:{createObjectURL(blob){urls.push(blob);return"blob:test";},revokeObjectURL(){}},setTimeout(fn){fn();}};
  const records=[{drug:A,dose:5,time:PLANNED-7*D,note:"전량보존"},{drug:A,dose:3,time:PLANNED-14*D,isOverride:true}];
  const before=structuredClone(records);
  const api=installScheduleComparison({document:doc,targetWindow:win,configs:{[A]:{halfLifeDays:5,tmaxHours:8,short:"A"},[B]:{halfLifeDays:6,tmaxHours:24,short:"B"}},getRecords:()=>records,getDoseCycle:()=>7,contribution,now:()=>NOW});
  return{doc,api,records,before,links,blobs,urls};
}
function setValid(fx,{changed="2030-01-05T12:00",drug=A}={}){
  const d=fx.doc.getElementById("sc-drug");d.value=drug;d.dispatch("change");
  for(const[id,value]of [["dose",drug===A?"5":"3"],["cycle","7"],["planned","2030-01-03T12:00"],["changed",changed]]){const e=fx.doc.getElementById(`sc-${id}`);e.value=value;e.dispatch("input");}
}

test("실제 계산 버튼은 목표별 역산값을 렌더하고 실제 모델로 순방향 일치를 보인다",()=>{
  const fx=setup();setValid(fx);fx.doc.getElementById("sc-review-calculate").click();
  const html=fx.doc.getElementById("sc-review-table").innerHTML;
  assert.match(html,/변경 후/);assert.match(html,/≈/);assert.equal(fx.doc.getElementById("sc-review-result").hidden,false);
  const review=buildModelInputReview({records:fx.records,drug:A,config:{halfLifeDays:5,tmaxHours:8},doseMg:5,plannedTime:PLANNED,changedTime:PLANNED+2*D,intervalDays:7,nextMode:"original",now:NOW,targetTimes:modelReviewTargets(PLANNED+2*D,8),contribution:pk});
  assert.ok(review.rows.every(r=>r.status==="review_value"&&Math.abs(r.equalityResidual)<1e-8));
  assert.ok(review.rows.some(r=>Math.abs(r.deltaFromReferenceMg)>1e-6));assert.deepEqual(fx.records,fx.before);
});

test("입력 변경과 약 전환은 오래된 역산표와 다운로드를 폐기한다",()=>{
  const fx=setup();setValid(fx);fx.doc.getElementById("sc-review-calculate").click();
  const dose=fx.doc.getElementById("sc-dose");dose.value="5.5";dose.dispatch("input");
  assert.equal(fx.doc.getElementById("sc-review-result").hidden,true);fx.doc.getElementById("sc-review-download").click();assert.equal(fx.blobs.length,0);
  fx.doc.getElementById("sc-review-calculate").click();const drug=fx.doc.getElementById("sc-drug");drug.value=B;drug.dispatch("change");
  assert.equal(fx.doc.getElementById("sc-review-result").hidden,true);assert.equal(fx.doc.getElementById("sc-review-target").value,"");
});

test("손상 목표·흡수반응 0·음수해는 가상 입력량을 산출하지 않는다",()=>{
  const bad=setup();setValid(bad);const target=bad.doc.getElementById("sc-review-target");target.value="2030-02-30T12:00";target.dispatch("input");bad.doc.getElementById("sc-review-calculate").click();assert.match(bad.doc.getElementById("sc-review-error").textContent,/올바르게/);
  const zero=setup({contribution:()=>0});setValid(zero);zero.doc.getElementById("sc-review-calculate").click();assert.match(zero.doc.getElementById("sc-review-table").innerHTML,/산출하지 않음/);
  const negative=buildModelInputReview({records:[],drug:A,config:{halfLifeDays:5,tmaxHours:8},doseMg:5,plannedTime:PLANNED,changedTime:PLANNED-2*D,intervalDays:7,nextMode:"shifted",now:PLANNED-H,targetTimes:[PLANNED-2*D+7*D+H],contribution:(dose,e)=>e<0?0:dose*Math.exp(-e/120)});
  assert.equal(negative.rows[0].status,"no_nonnegative_solution");assert.equal(negative.rows[0].modelInputMg,null);
});

test("목표시각은 시간순·중복 없이 custom을 추가한다",()=>{
  const custom=PLANNED+36*H, values=modelReviewTargets(PLANNED,24,custom);
  assert.deepEqual(values,[PLANNED+24*H,custom,PLANNED+48*H,PLANNED+72*H]);assert.equal(new Set(values).size,values.length);
});

test("검토 txt는 전 파라미터·기록·행·가정·출처와 숫자 차이를 보존한다",()=>{
  const review=buildModelInputReview({records:[{drug:A,dose:3,time:PLANNED-7*D},{drug:A,dose:5,time:PLANNED-14*D,isOverride:true}],drug:A,config:{halfLifeDays:5,tmaxHours:8},doseMg:5,plannedTime:PLANNED,changedTime:PLANNED+2*D,intervalDays:7,nextMode:"original",now:PLANNED-H,targetTimes:modelReviewTargets(PLANNED+2*D,8),contribution:pk});
  const text=buildModelReviewText({drug:A,config:{halfLifeDays:5,tmaxHours:8},doseMg:5,plannedTime:PLANNED,changedTime:PLANNED+2*D,intervalDays:7,nextMode:"original",review,createdAt:NOW});
  for(const token of ["평소 모델 입력: 5 mg","반감기 5일","투약 기록 | 3 mg","수동 모델값 입력 | 5 mg","각 행은 별개의","실측 ng/mL 또는 실제 체내 잔류 mg가 아님","개인별 오차범위","PMC10962491","FDA","lilly.com"])assert.match(text,new RegExp(token,"i"));
  assert.equal((text.match(/수학적 검산:/g)||[]).length,review.rows.filter(r=>r.status==="review_value").length);assert.match(text,/평소 입력과 차이 ≈[+-]?[0-9]/);
});

test("저장 버튼은 메모리 Blob을 만들고 원자료를 바꾸지 않는다",async()=>{
  const fx=setup();setValid(fx);fx.doc.getElementById("sc-review-calculate").click();fx.doc.getElementById("sc-review-download").click();
  assert.equal(fx.blobs.length,1);assert.equal(fx.links.length,1);assert.equal(fx.links[0].clicked,true);assert.match(fx.links[0].download,/모델검토표_203001011200\.txt/);
  const text=await fx.blobs[0].text();assert.match(text,/진료 검토용 가상 모델 입력 비교표/);assert.deepEqual(fx.records,fx.before);
});
