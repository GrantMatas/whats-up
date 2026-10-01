import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,mkdirSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import electron from 'electron';
const isolated=mkdtempSync(join(tmpdir(),'whatsup-real-smoke-'));const output=resolve('artifacts/real-smoke');mkdirSync(output,{recursive:true});
rmSync(join(output,'report.json'),{force:true});
const env={...process.env,WHATSUP_DATA_DIR:isolated,WHATSUP_SMOKE_DIR:output};delete env.ELECTRON_RUN_AS_NODE;delete env.WHATSUP_DEV_URL;
const reuse=process.env.WHATSUP_QA_SOURCE;if(reuse){for(const name of ['whats-up.sqlite','whats-up.sqlite-wal','whats-up.sqlite-shm'])if(existsSync(join(reuse,name)))copyFileSync(join(reuse,name),join(isolated,name));env.WHATSUP_QA_REUSE='1';}
const executable=process.argv[2]||electron;const args=process.argv[2]?['--real-smoke-test']:['.','--real-smoke-test'];
args.push('--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling','--user-data-dir='+isolated);
const child=spawn(executable,args,{env,stdio:'inherit',windowsHide:true});const timer=setTimeout(()=>{child.kill();process.exitCode=1;},420000);
child.on('exit',code=>{clearTimeout(timer);const file=join(output,'report.json');if(!existsSync(file)){console.error('Real smoke did not create a report');process.exitCode=1;return;}const report=JSON.parse(readFileSync(file));console.log(JSON.stringify({...report,dataDirectory:isolated},null,2));process.exitCode=code===0&&report.passed?0:1;});
