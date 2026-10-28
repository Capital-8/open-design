import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {importResources,verifyResources} from '../scripts/resources/snapshot.js';
import {generateMeta} from '../scripts/resources/official-meta.js';
import {buildBundledCatalog} from '../scripts/resources/build-catalog.js';
import {officialPackage,packageSource} from '../scripts/resources/package.js';
import {OfficialCatalog} from '@open-design/biz/catalog/official';
it('builds a pinned offline bundle, resolves dependencies and rejects changes or missing resources',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'od-resource-build-')),source=join(directory,'source'),resources=join(directory,'resources');await mkdir(source);
 const files={'LICENSE':'Fixture license','craft/layout.md':'Layout rules','design-systems/sample/DESIGN.md':'Design rules','design-systems/sample/manifest.json':JSON.stringify({schemaVersion:'1',id:'sample',name:'Sample'}),'design-templates/deck/SKILL.md':'---\nname: deck\ndescription: Deck\n---\nDeck rules','skills/draw/SKILL.md':'---\nname: draw\ndescription: Draw\n---\nDraw rules','plugins/_official/sample/open-design.json':JSON.stringify({name:'sample',title:'Sample',version:'1',od:{context:{skills:[{ref:'draw'}],craft:['layout']}}}),'data/plugin-previews/manifest.json':'{"previews":{}}'};
 try{for(const [path,text]of Object.entries(files)){await mkdir(dirname(join(source,path)),{recursive:true});await writeFile(join(source,path),text);}const git=(...args:string[])=>execFileSync('git',['-C',source,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','-c','commit.gpgsign=false','commit','-m','Fixture');const revision=git('rev-parse','HEAD').trim();await importResources(source,resources,revision);const meta=await generateMeta(resources);expect(meta.resources).toHaveLength(4);expect(meta.resources.every(r=>r.issues.length===0)).toBe(true);const reader=(path:string)=>readFile(join(resources,path));const catalog=Object.assign(new OfficialCatalog(meta,reader),{root:resources});const pack=await officialPackage(catalog,{type:'plugin',id:'sample'},await packageSource(catalog));expect(pack.entries.map(e=>e.path)).toContain('craft/layout.md');expect(pack.entries.map(e=>e.path)).toContain('skills/draw/SKILL.md');await buildBundledCatalog(resources,join(directory,'catalog.sqlite'));const db=new DatabaseSync(join(directory,'catalog.sqlite'),{readOnly:true});expect(db.prepare('SELECT count(*) AS n FROM installed_plugins').get()?.n).toBe(1);db.close();
 await writeFile(join(resources,'craft/layout.md'),'changed');await expect(verifyResources(resources)).rejects.toThrow('integrity mismatch');await writeFile(join(source,'skills/draw/SKILL.md'),'changed');await expect(importResources(source,join(directory,'other'),revision)).rejects.toThrow('tracked edits');
 const invalid=structuredClone(meta);invalid.resources.find(r=>r.id==='sample'&&r.type==='plugin')!.issues.push('Missing craft');expect(()=>new OfficialCatalog(invalid,reader).closure([{type:'plugin',id:'sample'}])).toThrow('Missing craft');
 }finally{await rm(directory,{recursive:true,force:true});}
});
