import {Help} from '../components/help';
import {Btn} from '../components/store';
export const metadata={title:'Help & Frequently Asked Questions',description:'Answers about Apex puck types, custom printing, artwork files, team orders, free samples, US delivery, returns and order support.',alternates:{canonical:'/faq'}};
export default function Page(){return <main id="main"><section className="page-intro"><p className="eyebrow">APEX / HELP CENTER</p><h1>GET THE<br/><em>RIGHT ANSWER.</em></h1></section><section className="section"><Help/></section><section className="sample-banner"><div><h2>STILL ON YOUR MIND?</h2><p>Ask Apex about your product, artwork or order.</p></div><Btn href="/contact">Get in touch</Btn></section></main>}
