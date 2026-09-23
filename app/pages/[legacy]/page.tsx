import {permanentRedirect,notFound} from 'next/navigation';
export default async function Page({params}:{params:Promise<{legacy:string}>}){const {legacy}=await params;const routes:Record<string,string>={contact:'/contact',about:'/manufacturing','order-custom-pucks':'/custom-pucks',policies:'/support/terms'};if(routes[legacy])permanentRedirect(routes[legacy]);notFound()}
