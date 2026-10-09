/** Verification harness only: exercise electron-updater's real range reconstruction on two NSIS packages. */
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const zlib=require('node:zlib');const crypto=require('node:crypto');
const { GenericDifferentialDownloader }=require('electron-updater/out/differentialDownloader/GenericDifferentialDownloader');
const { NodeHttpExecutor }=require('builder-util/out/nodeHttpExecutor');const { CancellationToken }=require('builder-util-runtime');const yaml=require('js-yaml');
async function measure(oldFile,newFile,directory) {
 fs.mkdirSync(directory,{recursive:true});
 const hash=file=>crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
 const total=fs.statSync(newFile).size;const sha512=hash(newFile);let downloaded=0,requests=0;
 const server=http.createServer((request,response)=>{
  const match=/^bytes=(\d+)-(\d+)$/.exec(request.headers.range||'');
  const start=match?Number(match[1]):0,end=match?Number(match[2]):total-1;
  if(start>end||end>=total){response.writeHead(416);response.end();return;}
  response.writeHead(match?206:200,{'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Type':'application/octet-stream',...(match?{'Content-Range':`bytes ${start}-${end}/${total}`}:{})});
  requests++;const stream=fs.createReadStream(newFile,{start,end});stream.on('data',data=>downloaded+=data.length);stream.pipe(response);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const resultFile=path.join(directory,'reconstructed.exe');
 try {
  const options={oldFile,newFile:resultFile,newUrl:new URL(`http://127.0.0.1:${server.address().port}/installer.exe`),logger:{info:console.log,warn:console.warn,error:console.error},requestHeaders:null,isUseMultipleRangeRequest:false,cancellationToken:new CancellationToken()};
  const readMap=file=>JSON.parse(zlib.gunzipSync(fs.readFileSync(file+'.blockmap')).toString());
  await new GenericDifferentialDownloader({size:total,sha512},new NodeHttpExecutor(),options).download(readMap(oldFile),readMap(newFile));
  if(hash(resultFile)!==sha512)throw new Error('Reconstructed installer failed SHA-512.');
  const differentialBytes=downloaded,differentialRequests=requests;
  downloaded=0;requests=0;
  const full=Buffer.from(await (await fetch(options.newUrl)).arrayBuffer());
  if(crypto.createHash('sha512').update(full).digest('base64')!==sha512)throw new Error('Full transfer failed SHA-512.');
  const blockmapBytes=fs.statSync(oldFile+'.blockmap').size+fs.statSync(newFile+'.blockmap').size;
  const report={oldFile:path.basename(oldFile),newFile:path.basename(newFile),differentialBytes,blockmapBytes,withBlockmaps:differentialBytes+blockmapBytes,fullBytes:downloaded,differentialRequests,savingPercent:Number((100*(1-(differentialBytes+blockmapBytes)/downloaded)).toFixed(2)),sha512,verified:true,scope:'Real packaged artifacts; local HTTP range transport and library reconstruction. Does not test NSIS installation or production CDN.'};
  fs.writeFileSync(path.join(directory,'differential-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));return report;
 } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
}
module.exports={measure};
if(require.main===module)measure(path.resolve(process.argv[2]),path.resolve(process.argv[3]),path.resolve(process.argv[4]||'.validation/differential')).catch(error=>{console.error(error);process.exitCode=1;});
