import {MotionSystem} from './components/physical';
import type {Metadata} from 'next';
import './globals.css';
import './physical.css';
import {Header,Footer,StoreProvider} from './components/store';
import {ORIGIN,EMAIL} from '@/lib/apex';
export const metadata:Metadata={metadataBase:new URL(ORIGIN),title:{default:'Apex Hockey Pucks | The Game Starts Here',template:'%s | Apex Hockey Pucks'},description:'Shop Apex game and markless hockey pucks. Custom logo printing and team orders, direct from an American-owned puck manufacturer. Made in Sri Lanka.',openGraph:{type:'website',siteName:'Apex Hockey Pucks',locale:'en_US'},icons:{icon:'/assets/logo.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><head><link rel="preload" href="/assets/display.woff" as="font" type="font/woff" crossOrigin="anonymous"/></head><body><MotionSystem/><StoreProvider><Header/>{children}<Footer/></StoreProvider><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({'@context':'https://schema.org','@type':'Organization',name:'Apex Hockey Pucks Inc.',url:ORIGIN,logo:`${ORIGIN}/assets/logo.svg`,email:EMAIL,address:{'@type':'PostalAddress',streetAddress:'820 Grand Blvd.',addressLocality:'Deer Park',addressRegion:'NY',postalCode:'11729',addressCountry:'US'},sameAs:['https://instagram.com/apexpropucks']})}}/></body></html>}
