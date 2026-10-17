// Emscripten synchronous file operations backed by an OPFS worker handle.
// Only the requested output file is exposed; no full output lives in MEMFS.
(function(root){
 root.VideoPocketOutputFS=(FS,access,filename)=>({mount(){
  const directory=FS.createNode(null,'/',0o40777,0),file=FS.createNode(directory,filename,0o100666,0);let time=Date.now();
  const attrs=node=>({dev:1,ino:node.id,mode:node.mode,nlink:1,uid:0,gid:0,rdev:0,size:node===file?access.getSize():4096,atime:new Date(time),mtime:new Date(time),ctime:new Date(time),blksize:4096,blocks:node===file?Math.ceil(access.getSize()/4096):1});
  const missing=()=>{throw new FS.ErrnoError(44);};
  directory.node_ops={getattr:attrs,lookup:(node,name)=>name===filename?file:missing(),readdir:()=>['.','..',filename]};
  file.node_ops={getattr:attrs,setattr(node,attr){if(attr.size!==undefined)access.truncate(attr.size);if(attr.mode!==undefined)node.mode=attr.mode;time=attr.timestamp || Date.now();}};
  file.stream_ops={read(stream,buffer,offset,length,position){return access.read(buffer.subarray(offset,offset+length),{at:position});},write(stream,buffer,offset,length,position){const count=access.write(buffer.subarray(offset,offset+length),{at:position});time=Date.now();return count;},llseek(stream,offset,whence){const position=whence===1?stream.position+offset:whence===2?access.getSize()+offset:offset;if(position<0||!Number.isSafeInteger(position))throw new FS.ErrnoError(28);return position;}};
  return directory;
 }});
})(self);
