import {CartContents} from '../components/store';
export const metadata={title:'Your Cart',robots:{index:false,follow:true}};
export default function Page(){return <main id="main" className="section cart-page"><p className="eyebrow">THE NEXT GAME STARTS HERE</p><h1>YOUR KIT.</h1><CartContents/></main>}
