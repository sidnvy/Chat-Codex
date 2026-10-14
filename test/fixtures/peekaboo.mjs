import {PeekabooDesktop} from '../../src/desktop/peekaboo.mjs';
export function peekabooFixture(){
 const state={now:1000,granted:true,session:{ready:true,session_id:'test-session'},title:'Scratch',pid:42,start:'123456789012345678',calls:[],see:{},mutate:null};
 const run=async(_command,args)=>{
  state.calls.push(args);
  let data={};
  if(args[0]==='permissions')data={permissions:['Screen Recording','Accessibility'].map(name=>({name,isGranted:state.granted}))};
  if(args[0]==='app')data={apps:[{pid:state.pid,name:'Scratch',process_start_identity_decimal:state.start}],warnings:[]};
  if(args[0]==='window')data={target_application_info:{pid:state.pid},inventory_completeness:'complete',windows:[{window_id:123,window_title:state.title}]};
  if(args[0]==='see')data={snapshot_id:'pb-snap',snapshot_reusable:true,mutation_targeting_available:true,semantic_scope:'exact_or_requested',capture_mode:'window',coordinate_context:{window:{window_id:123,title:state.title}},observation:{target:{window_id:123}},window_title:state.title,screenshot_raw:'',ui_elements:[{id:'B1',role:'button',label:'Save'}],...state.see};
  if(state.mutate)await state.mutate(args,data);
  return JSON.stringify({success:true,data});
 };
 return {state,run,driver:new PeekabooDesktop(run,async()=>state.session,()=>state.now)};
}
