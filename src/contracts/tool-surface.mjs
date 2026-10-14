/**
 * Transport-independent, schema-only MCP tool conformance representation.
 * Does not store tool descriptions, examples, connection URLs or credentials.
 *
 * A JSON Schema structural diff is a compatibility diagnostic, NOT a proof
 * that different backend effects or schema compositions behave identically.
 */
const IGNORE_SCHEMA_FIELDS=new Set(['description','title','$comment','examples']);
const ANNOTATIONS=['readOnlyHint','destructiveHint','idempotentHint','openWorldHint'];
const SAFE_NAME=/^[A-Za-z0-9_.-]{1,128}$/;
export const TOOL_CONTRACT_VERSION=1;

// JSON Schema objects, JSON instance literals, property-keyed dictionaries,
// and unordered sets have different rules. Never infer the role of a nested
// object from a *property name in user data* (e.g. "properties.properties").
const SCHEMA_MAP_KEYS=new Set(['properties','patternProperties','$defs','definitions','dependentSchemas']);
const SCHEMA_SET_KEYS=new Set(['allOf','anyOf','oneOf']);
const SCHEMA_SINGLE_KEYS=new Set(['items','additionalItems','additionalProperties',
 'propertyNames','contains','not','if','then','else','unevaluatedItems',
 'unevaluatedProperties','contentSchema']);
const SCHEMA_SEQUENCE_KEYS=new Set(['prefixItems']);
const UNORDERED_KEYS=new Set(['required','type']);
function childContext(context,field,value){
 if(context==='literal')return 'literal';
 if(context==='schemaMap')return 'schema';
 if(context==='requiredMap')return 'set';
 if(context==='dependencyMap')return Array.isArray(value)?'set':'schema';
 if(context!=='schema')throw Error('Invalid JSON Schema normalization context');
 if(SCHEMA_MAP_KEYS.has(field))return 'schemaMap';
 if(field==='dependentRequired')return 'requiredMap';
 if(field==='dependencies')return 'dependencyMap';
 if(field==='const')return 'literal';
 if(field==='enum')return 'enum';
 if(UNORDERED_KEYS.has(field))return 'set';
 if(SCHEMA_SET_KEYS.has(field))return 'schemaSet';
 if(SCHEMA_SEQUENCE_KEYS.has(field))return 'schemaSequence';
 if(SCHEMA_SINGLE_KEYS.has(field))return Array.isArray(value)?'schemaSequence':'schema';
 // Unknown extension keywords may contain arbitrary JSON instance values.
 // Keep them verbatim rather than deleting metadata-looking keys.
 return 'literal';
}
function canonical(value,context='schema'){
 if(Array.isArray(value)){
  const elementContext=context==='enum'||context==='literal'?'literal':
   context==='schemaSet'||context==='schemaSequence'?'schema':'literal';
  const entries=value.map(item=>canonical(item,elementContext));
  return ['set','enum','schemaSet'].includes(context)
   ?entries.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))
   :entries;
 }
 if(value&&typeof value==='object'){
  const object={}; // Own properties are defined explicitly for reserved names.
  for(const field of Object.keys(value).sort()){
   if(context==='schema'&&IGNORE_SCHEMA_FIELDS.has(field))continue;
   const next=value[field];
   if(next!==undefined)Object.defineProperty(object,field,{value:canonical(next,childContext(context,field,next)),enumerable:true,configurable:true,writable:true});
  }
  return object;
 }
 if(value===null||['string','boolean','number'].includes(typeof value))return value;
 throw Error('MCP tool schema contains a non-JSON value');
}
function inputTools(raw){
 const value=Array.isArray(raw)?raw:raw?.tools;
 if(!Array.isArray(value))throw Error('MCP tool snapshot must contain a tools array');
 return value;
}
export function normalizeToolSurface(raw,{names}={}){
 const tools=inputTools(raw),wanted=names?new Set(names):null;
 if(wanted&&(wanted.size!==names.length||[...wanted].some(s=>!SAFE_NAME.test(s))))
  throw Error('Invalid or duplicated expected tool names');
 const table=Object.create(null);
 for(const tool of tools){
  if(!tool||typeof tool.name!=='string')throw Error('Invalid MCP tool name');
  if(wanted&&!wanted.has(tool.name))continue;
  if(!SAFE_NAME.test(tool.name))throw Error('Invalid selected MCP tool name');
  if(Object.hasOwn(table,tool.name))throw Error('Duplicate MCP tool name: '+tool.name);
  if(!tool.inputSchema||typeof tool.inputSchema!=='object'||Array.isArray(tool.inputSchema))
   throw Error('Missing input schema for '+tool.name);
  const annotations={};
  for(const flag of ANNOTATIONS){
   // Deliberately record null for missing annotations: "unspecified" is not
   // equivalent to an explicit false in a cross-gateway comparison.
   const observed=tool.annotations?.[flag];
   if(observed!==undefined&&observed!==null&&typeof observed!=='boolean')
    throw Error('Invalid annotation for '+tool.name);
   annotations[flag]=observed??null;
  }
  table[tool.name]={inputSchema:canonical(tool.inputSchema),annotations};
 }
 const missing=wanted?[...wanted].filter(name=>!Object.hasOwn(table,name)): [];
 if(missing.length)throw Error('Required MCP tool names missing: '+missing.join(','));
 return {contract_version:TOOL_CONTRACT_VERSION,tools:Object.fromEntries(Object.entries(table).sort(([a],[b])=>a.localeCompare(b)))};
}
function validateNormalized(snapshot){
 if(!snapshot||snapshot.contract_version!==TOOL_CONTRACT_VERSION||
   !snapshot.tools||typeof snapshot.tools!=='object'||Array.isArray(snapshot.tools))
  throw Error('Invalid normalized tool contract snapshot');
 return normalizeToolSurface(Object.entries(snapshot.tools).map(([name,data])=>{
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.hasOwn(data,'name'))
   throw Error('Invalid normalized tool entry');
  return {...data,name}; // Map key is authoritative; no nested name override.
 }));
}
function walk(a,b,p,out,maxChanges){
 if(out.length>=maxChanges)return;
 if(JSON.stringify(a)===JSON.stringify(b))return;
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
  for(const k of new Set([...Object.keys(a),...Object.keys(b)].sort())){
   if(out.length>=maxChanges)break;
   walk(Object.hasOwn(a,k)?a[k]:undefined,Object.hasOwn(b,k)?b[k]:undefined,
    p+'/'+k.replaceAll('~','~0').replaceAll('/','~1'),out,maxChanges);
  }
  return;
 }
 out.push({path:p||'/',difference:a===undefined?'left_missing':b===undefined?'right_missing':'value_or_constraint_changed'});
}
export function compareToolSurfaces(leftRaw,rightRaw,{maxChangesPerTool=100}={}){
 if(!Number.isInteger(maxChangesPerTool)||maxChangesPerTool<1||maxChangesPerTool>500)
  throw Error('Invalid maximum diff size');
 const left=validateNormalized(leftRaw),right=validateNormalized(rightRaw);
 const shared=Object.keys(left.tools).filter(name=>Object.hasOwn(right.tools,name));
 const onlyLeft=Object.keys(left.tools).filter(name=>!Object.hasOwn(right.tools,name));
 const onlyRight=Object.keys(right.tools).filter(name=>!Object.hasOwn(left.tools,name));
 const differences=[];
 for(const name of shared){
  const fields=[];
  walk(left.tools[name],right.tools[name],'',fields,maxChangesPerTool+1);
  if(fields.length)differences.push({name,changes:fields.slice(0,maxChangesPerTool),truncated:fields.length>maxChangesPerTool});
 }
 return {
  contract_version:TOOL_CONTRACT_VERSION,
  compatible_structure:!onlyLeft.length&&!onlyRight.length&&!differences.length,
  summary:{left_total:Object.keys(left.tools).length,right_total:Object.keys(right.tools).length,
   shared:shared.length,only_left:onlyLeft.length,only_right:onlyRight.length,changed:differences.length},
  only_left:onlyLeft,only_right:onlyRight,differences
 };
}