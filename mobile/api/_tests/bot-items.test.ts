import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handleBot } from '../bot';

function gasFixture() {
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({}) },
  });
  vm.runInContext(readFileSync('gas/scheduler.gs','utf8') + `
    this.person = {title:'專科護理師'};
    this.rows = {
      a: {hospital_code:'00123',name_zh:'測試自費',name_en:'Sample',depts:'骨科',price:'0',unit:'個',notes:'private',secret:'hidden'},
      b: {hospital_code:'B456',name_zh:'其他自費',name_en:'Other',depts:'泌尿科',price:'',unit:''}
    };
    this.reads = [];
    _apiKey = () => 'test-key';
    _requireApiKey = () => false;
    _findPhysicianByHis = (ss,his) => his === 'bound' ? this.person : null;
    _mobileMatrix = () => _mobileNormalize(this.matrix || null);
    _readSyncTable = (ss,table) => { this.reads.push(table); return {rows:this.rows}; };
    json = value => value;
    this.run = p => doPost({postData:{contents:JSON.stringify(p)}});
  `, context);
  return context as typeof context & {run:(p:Record<string,unknown>)=>Record<string,unknown>;reads:string[];person:unknown;matrix:unknown;rows:Record<string,unknown>};
}

describe('LINE 自費唯讀查詢', () => {
  it('GAS requires a service key even when the general key requirement is disabled', () => {
    const g=gasFixture();
    expect(g.run({action:'botItems',his:'bound',query:'Sample'})).toMatchObject({ok:false});
    expect(g.reads).toEqual([]);
  });
  it('current MedBase access is enforced before reading items, including revoked access', () => {
    const g=gasFixture();
    const query={api_key:'test-key',action:'botItems',his:'bound',query:'Sample'};
    expect(g.run(query)).toMatchObject({ok:true,total:1,items:[{hospital_code:'00123',price:0}]});
    g.matrix={np:[]};
    g.reads.length=0;
    expect(g.run(query)).toMatchObject({ok:false,code:'FORBIDDEN'});
    expect(g.reads).toEqual([]);
    g.person={title:'護理師'};g.matrix=null;
    expect(g.run(query)).toMatchObject({ok:false,code:'FORBIDDEN'});
  });
  it('search matches all terms and returns only approved fields with stable pages', async () => {
    const g=gasFixture();
    const gas=async(p:Record<string,unknown>)=>g.run({...p,api_key:'test-key'}) as {ok:boolean;[k:string]:unknown};
    const result=await handleBot({action:'items',his:'bound',query:'骨科 Sample',offset:0},gas);
    expect(result).toEqual({ok:true,total:1,offset:0,items:[{hospital_code:'00123',name_zh:'測試自費',name_en:'Sample',price:0,unit:'個',depts:['骨科']}]});
    expect(await handleBot({action:'items',his:'bound',query:'不在名單'},gas)).toMatchObject({total:0,items:[]});
    for(let i=0;i<7;i++)g.rows['extra'+i]={hospital_code:'A'+i,name_zh:'範例'+i,price:'',depts:''};
    const first=await handleBot({action:'items',his:'bound',query:'範例'},gas);
    const second=await handleBot({action:'items',his:'bound',query:'範例',offset:5},gas);
    expect(first.items).toHaveLength(5); expect(second.items).toHaveLength(2);
    expect((second.items as {price:unknown}[])[0].price).toBeNull();
    await expect(handleBot({action:'items',his:'',query:'x'},gas)).rejects.toThrow();
    await expect(handleBot({action:'items',his:'bound',query:'x',offset:-1},gas)).rejects.toThrow();
    await expect(handleBot({action:'items',his:'bound',query:'x'.repeat(101)},gas)).rejects.toThrow();
  });
});
