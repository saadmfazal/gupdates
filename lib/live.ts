export type LiveCatalogue={products:{handle:string;variants:{id:string;price:number;available:boolean}[]}[]};
export function parseCatalogue(value:unknown):LiveCatalogue|null{
 if(!value||typeof value!=='object'||!('products' in value)||!Array.isArray(value.products))return null;
 const products:LiveCatalogue['products']=[];
 for(const item of value.products){
  if(!item||typeof item!=='object'||typeof item.handle!=='string'||!Array.isArray(item.variants))continue;
  const variants=item.variants.flatMap((v:unknown)=>{
   if(!v||typeof v!=='object'||!('id' in v)||!('price' in v)||!('available' in v))return [];
   const id=String(v.id),price=Number(v.price);
   return /^\d+$/.test(id)&&Number.isFinite(price)&&price>=0&&typeof v.available==='boolean'?[{id,price,available:v.available}]:[];
  });
  products.push({handle:item.handle,variants});
 }
 return {products};
}
