export const show=data=>({content:[{type:'text',text:JSON.stringify(data)}],structuredContent:Array.isArray(data)?{items:data}:data});
export const failed=e=>({isError:true,content:[{type:'text',text:String(e.message??e).slice(0,500)}]});
