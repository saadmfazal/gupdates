import type { NextConfig } from 'next';
const assetOrigin='https://apex-hockey-pucks-rebuilt.vercel.app';
const config: NextConfig = {
 async rewrites(){return [
  {source:'/assets/:path*',destination:`${assetOrigin}/assets/:path*`},
  {source:'/favicon.svg',destination:`${assetOrigin}/favicon.svg`},
 ];},
};
export default config;
