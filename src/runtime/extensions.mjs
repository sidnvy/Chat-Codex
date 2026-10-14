const ID=/^[a-z][a-z0-9-]{0,30}$/;
const ACTION=/^[a-z][a-z0-9_]{0,62}$/;
const MAX_OUTPUT=65536;
const readAnnotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true};
const mutateAnnotations={readOnlyHint:false,destructiveHint:true,idempotentHint:false};

/**
 * In-process trusted extensions. An operator must both inject the code at
 * startup AND grant the namespace in private configuration for tools to
 * appear. This registry is not a sandbox for untrusted JavaScript modules.
 */
export class ExtensionCatalog{
 constructor(){this.entries=new Map();this.sealed=false;}
 seal(){this.sealed=true;return this;}
 register(extension){
  if(this.sealed)throw Error('Extension catalog is sealed');
  const {id,tools}=extension??{};
  if(typeof id!=='string'||!ID.test(id)||!Array.isArray(tools)||
   tools.length<1||tools.length>16)throw Error('Invalid extension registration');
  if(this.entries.has(id))throw Error('Duplicate extension namespace: '+id);
  const names=new Set();
  const definitions=tools.map(tool=>{
   if(!tool||typeof tool.name!=='string'||!ACTION.test(tool.name)||
    names.has(tool.name)||typeof tool.description!=='string'||
    !tool.description||tool.description.length>300||
    typeof tool.schema?.safeParse!=='function'||
    typeof tool.handler!=='function'||typeof tool.readOnly!=='boolean')
     throw Error('Invalid extension tool definition');
   names.add(tool.name);
   return Object.freeze({...tool,fullName:'ext_'+id+'_'+tool.name});
  });
  this.entries.set(id,Object.freeze({id,tools:Object.freeze(definitions)}));
  return this;
 }
 list(){return [...this.entries.keys()];}
 get(id){return this.entries.get(id);}
 validateGrants(ids=[]){
  if(!Array.isArray(ids)||new Set(ids).size!==ids.length||
   ids.some(id=>typeof id!=='string'||!this.entries.has(id)))
    throw Error('Private configuration grants an unavailable extension');
  return Object.freeze([...ids]);
 }
}

/** Only explicitly granted, registered extensions become model-facing tools. */
export function registerGrantedExtensions(mcp,catalog,grants,api){
 for(const id of grants){
  const entry=catalog.get(id);
  for(const t of entry.tools){
   mcp.registerTool(t.fullName,{
    description:t.description,
    inputSchema:t.schema,
    annotations:t.readOnly?readAnnotations:mutateAnnotations,
   },async args=>{
    try {
     // A frozen narrow API is offered; no token, private config, registry
     // mutable object, or Coder/Docker internals are passed to extensions.
     const value=await t.handler(args,api);
     const serialized=JSON.stringify(value);
     if(typeof serialized!=='string'||Buffer.byteLength(serialized)>MAX_OUTPUT)
      throw Error('invalid_extension_output');
     return {content:[{type:'text',text:serialized}],
      structuredContent:value&&typeof value==='object'&&!Array.isArray(value)?value:{value}};
    }catch{
     return {isError:true,content:[{type:'text',text:'Extension operation failed; no automatic retry.'}]};
    }
   });
  }
 }
}