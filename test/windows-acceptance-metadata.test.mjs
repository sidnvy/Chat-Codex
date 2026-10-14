import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeResultMetadata} from '../scripts/windows-desktop-acceptance.mjs';
test('native Windows diagnostics expose shape/comparisons without raw identity or typed data',()=>{
 const selector='private-selector',hwnd='778899',secret='PRIVATE_TYPED_TEXT';
 const args=['ui','set-value',selector,secret,'-w',hwnd,'--json'];
 const result=nativeResultMetadata(JSON.stringify({data:{elementId:selector,hwnd:Number(hwnd),value:secret},private_key:secret}),args);
 assert.deepEqual(result.native_result,{top_level_fields:['data'],data_fields:['elementId','hwnd'],hwnd_type:'number',hwnd_matches_requested:true,element_id_type:'string',element_id_matches_requested:true});
 const serialized=JSON.stringify(result);for(const value of [selector,hwnd,secret,'private_key'])assert.ok(!serialized.includes(value));
 const mismatch=nativeResultMetadata(JSON.stringify({elementId:'different',hwnd:'other',pattern:secret,requestedAction:secret,performedAction:secret}),args);
 assert.equal(mismatch.native_result.hwnd_matches_requested,false);assert.equal(mismatch.native_result.element_id_matches_requested,false);
 assert.ok(!JSON.stringify(mismatch).includes(secret));
});
test('native Windows diagnostics allow only pinned outcome/error vocabulary',()=>{
 const args=['ui','invoke','button','--action','invoke','-w','42','--json'];
 const result=nativeResultMetadata(JSON.stringify({elementId:'button',hwnd:42,pattern:'InvokePattern',requestedAction:'invoke',performedAction:'invoke'}),args);
 assert.equal(result.native_result.pattern,'InvokePattern');assert.equal(result.native_result.requested_action,'invoke');
 assert.deepEqual(nativeResultMetadata('{'),{});
 assert.deepEqual(nativeResultMetadata(JSON.stringify({error:{code:'private',message:'private'}}),['ui','inspect']),{});
 assert.deepEqual(nativeResultMetadata(JSON.stringify({error:{code:'stale_element',message:'private'}}),['ui','inspect']),{native_error_code:'stale_element'});
});
