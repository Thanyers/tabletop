import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { processUpload,shipmentsFromCsv,invoiceFromCsv,csvRows } from './artifacts';
import { LocalObjectStore } from './storage';
import type { ActorContext } from '../src/tabletop/shared/contracts';
const ctx:ActorContext={actorId:'owner',name:'Owner',role:'owner',workspaceId:'w',epoch:1,now:1,hash:v=>createHash('sha256').update(JSON.stringify(v)).digest('hex')};
let directory:string;let store:LocalObjectStore;
beforeAll(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'tabletop-artifacts-test-'));store=new LocalObjectStore(directory)});
afterAll(async()=>{await rm(directory,{recursive:true,force:true})});
describe('bounded source import',()=>{
 it('reads quoted reordered CSV fields and retains missing weights',()=>{const rows=shipmentsFromCsv('zone,shipment_id,weight_gram,service_date,remote\nbangkok,"ID,001",1100,2026-10-20,false\nregional,MISSING,,2026-10-20,true','source');expect(rows[0]).toMatchObject({id:'ID,001',weightGram:1100,row:2});expect(rows[1].weightGram).toBeNull();expect(invoiceFromCsv('currency,billed_thb,shipment_id\nTHB,52.50,ID','source')[0].billedSatang).toBe(5250)});
 it('rejects malformed quoting, noninteger weight and impossible date',()=>{expect(()=>csvRows('a,b\n"broken,1')).toThrow();expect(()=>shipmentsFromCsv('shipment_id,zone,service_date,weight_gram,remote\na,bangkok,2026-02-30,1000,false','s')).toThrow();expect(()=>shipmentsFromCsv('shipment_id,zone,service_date,weight_gram,remote\na,bangkok,2026-02-20,1.5,false','s')).toThrow()});
 it('stores immutable opaque objects; imported evidence is provided, never verified',async()=>{const source='shipment_id,zone,service_date,weight_gram,remote\nSHIP-1,bangkok,2026-10-20,1100,true';const result=await processUpload({filename:'../../../orders.csv',mime:'text/csv',kind:'shipments',dataBase64:Buffer.from(source).toString('base64')},ctx,store);expect(result.artifact.status).toBe('provided');expect(result.artifact.filename).toBe('orders.csv');expect(result.shipments?.[0].sourceId).toBe(result.artifact.id);expect(Buffer.from(await store.get(result.artifact.id)).toString()).toBe(source);await expect(store.get('../secret')).rejects.toThrow()});
 it('rejects renamed binaries, mismatched MIME and invalid base64',async()=>{await expect(processUpload({filename:'test.pdf',mime:'application/pdf',kind:'invoice',dataBase64:Buffer.from('not pdf').toString('base64')},ctx,store)).rejects.toMatchObject({code:'PDF_MAGIC'});await expect(processUpload({filename:'test.html',mime:'text/html',kind:'rate-card',dataBase64:Buffer.from('<html>').toString('base64')},ctx,store)).rejects.toMatchObject({code:'UPLOAD_TYPE'});await expect(processUpload({filename:'test.txt',mime:'text/plain',kind:'excerpt',dataBase64:'****'},ctx,store)).rejects.toMatchObject({code:'UPLOAD_ENCODING'})});
 it('parses text PDF in a bounded child and normalizes the documented table',async()=>{
  // The fixture generator contains original test text, not third-party material.
  // @ts-expect-error JavaScript fixture is intentionally shared with browser tests.
  const {makeTextPdf}=await import('../tests/pdf-fixture.mjs');
  const data:Buffer=makeTextPdf(['TABLETOP INVOICE V1','shipment_id,billed_thb,currency','NEW-1,52.50,THB']);
  const result=await processUpload({filename:'invoice.pdf',mime:'application/pdf',kind:'invoice',dataBase64:data.toString('base64')},ctx,store);
  expect(result.artifact.pages).toHaveLength(1);expect(result.invoiceLines?.[0]).toMatchObject({id:'NEW-1',billedSatang:5250,currency:'THB'});
 });
});
