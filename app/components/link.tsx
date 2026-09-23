import type {AnchorHTMLAttributes} from 'react';
// Native navigation keeps query strings intact and works without JavaScript.
// Cross-document view transitions provide a short, optional visual handoff.
export default function SiteLink(props:AnchorHTMLAttributes<HTMLAnchorElement> & {href:string}){return <a {...props}/>}
