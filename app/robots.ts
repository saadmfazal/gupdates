import {ORIGIN} from '@/lib/apex';
export default function robots(){return {rules:{userAgent:'*',allow:'/',disallow:['/cart','/api/','/_qa']},sitemap:ORIGIN+'/sitemap.xml'}}
