using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Runtime.InteropServices;

// Distribution is one EXE. Only the embedded native module needs an on-disk
// image for the Windows loader; its dependencies are Windows system DLLs.
static class EmbeddedRuntime {
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
    [DllImport("kernel32.dll",CharSet=CharSet.Ansi,ExactSpelling=true)] static extern IntPtr GetProcAddress(IntPtr module,string name);
    static IntPtr module;
    public static byte[] Read(string name){using(var source=Assembly.GetExecutingAssembly().GetManifestResourceStream(name)){if(source==null)throw new IOException("Missing embedded resource: "+name);using(var output=new MemoryStream()){source.CopyTo(output);return output.ToArray();}}}
    public static T Function<T>(string name){if(module==IntPtr.Zero)throw new InvalidOperationException("Embedded renderer not initialized");var address=GetProcAddress(module,name);if(address==IntPtr.Zero)throw new EntryPointNotFoundException(name);return (T)(object)Marshal.GetDelegateForFunctionPointer(address,typeof(T));}
    static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    public static string Initialize(string profile){
        if(module!=IntPtr.Zero)return null;
        byte[] bytes;using(var input=new MemoryStream(Read("Cursor.Renderer.gz")))using(var gzip=new GZipStream(input,CompressionMode.Decompress))using(var output=new MemoryStream()){gzip.CopyTo(output);bytes=output.ToArray();}
        string hash=Hash(bytes),root=Path.Combine(profile,"runtime",hash),path=Path.Combine(root,"CursorRenderer.dll");Directory.CreateDirectory(root);
        if(!File.Exists(path)||Hash(File.ReadAllBytes(path))!=hash){
            string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";try{File.WriteAllBytes(temp,bytes);if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);}finally{if(File.Exists(temp))File.Delete(temp);}
        }
        // Absolute, verified module; search dependencies in System32 only.
        module=LoadLibraryEx(path,IntPtr.Zero,0x800);if(module==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();return path;
    }
}
