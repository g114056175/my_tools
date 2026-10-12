using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class ColorSelection {
    public static bool TryHex(string text,out Color value){
        value=Color.Empty;text=text.Trim().TrimStart('#');
        if(text.Length==3)text=new string(new[]{text[0],text[0],text[1],text[1],text[2],text[2]});
        int rgb;if(text.Length!=6||!int.TryParse(text,NumberStyles.HexNumber,CultureInfo.InvariantCulture,out rgb))return false;
        value=Color.FromArgb(255,(rgb>>16)&255,(rgb>>8)&255,rgb&255);return true;
    }
}

sealed class ColorPlane : Control {
    public readonly bool BrightnessOnly;public double Hue,Saturation,Brightness;
    public event EventHandler Changed;
    public ColorPlane(bool brightnessOnly){BrightnessOnly=brightnessOnly;Cursor=Cursors.Cross;TabStop=true;AccessibleRole=AccessibleRole.Slider;AccessibleName=brightnessOnly?"亮度":"色相與飽和度";SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.Selectable,true);}
    internal void Choose(int x,int y){
        double vertical=1-Math.Max(0,Math.Min(1,(double)y/Math.Max(1,Height-1)));
        if(BrightnessOnly)Brightness=vertical;else{Hue=Math.Max(0,Math.Min(1,(double)x/Math.Max(1,Width-1)));Saturation=vertical;}
        Invalidate();if(Changed!=null)Changed(this,EventArgs.Empty);
    }
    protected override void OnMouseDown(MouseEventArgs e){base.OnMouseDown(e);if(e.Button==MouseButtons.Left){Focus();Capture=true;Choose(e.X,e.Y);}}
    protected override void OnMouseMove(MouseEventArgs e){base.OnMouseMove(e);if(Capture)Choose(e.X,e.Y);}
    protected override void OnMouseUp(MouseEventArgs e){base.OnMouseUp(e);if(e.Button==MouseButtons.Left&&Capture){Choose(e.X,e.Y);Capture=false;}}
    protected override bool IsInputKey(Keys key){return key==Keys.Left||key==Keys.Right||key==Keys.Up||key==Keys.Down||base.IsInputKey(key);}
    protected override void OnKeyDown(KeyEventArgs e){base.OnKeyDown(e);int dx=e.KeyCode==Keys.Left?-1:e.KeyCode==Keys.Right?1:0,dy=e.KeyCode==Keys.Up?-1:e.KeyCode==Keys.Down?1:0;if(dx==0&&dy==0)return;if(BrightnessOnly)Choose(0,(int)Math.Round((1-Brightness)*(Height-1))+(dx+dy)*2);else Choose((int)Math.Round(Hue*(Width-1))+dx*2,(int)Math.Round((1-Saturation)*(Height-1))+dy*2);e.Handled=true;}
    protected override void OnPaint(PaintEventArgs e){
        if(Width<2||Height<2)return;var g=e.Graphics;var rect=new Rectangle(0,0,Width,Height);
        if(BrightnessOnly){
            using(var brush=new LinearGradientBrush(rect,Color.White,Color.Black,90)){brush.InterpolationColors=new ColorBlend{Colors=new[]{Color.White,ColorAlgorithm.HslColor(Hue,Saturation,.5),Color.Black},Positions=new[]{0f,.5f,1f}};g.FillRectangle(brush,rect);}
            float y=(float)(Brightness*(1-Height)+Height-1);using(var pen=new Pen(Color.Black,3))g.DrawLine(pen,0,y,Width,y);using(var pen=new Pen(Color.White,1))g.DrawLine(pen,0,y,Width,y);
        }else{
            using(var brush=new LinearGradientBrush(rect,Color.Red,Color.Red,0f)){brush.InterpolationColors=new ColorBlend{Colors=new[]{Color.Red,Color.Yellow,Color.Lime,Color.Cyan,Color.Blue,Color.Magenta,Color.Red},Positions=new[]{0f,1f/6,2f/6,3f/6,4f/6,5f/6,1f}};g.FillRectangle(brush,rect);}
            using(var brush=new LinearGradientBrush(rect,Color.FromArgb(0,128,128,128),Color.FromArgb(128,128,128),90))g.FillRectangle(brush,rect);
            float x=(float)Math.Max(5,Math.Min(Width-6,Hue*(Width-1))),y=(float)Math.Max(5,Math.Min(Height-6,(1-Saturation)*(Height-1)));g.SmoothingMode=SmoothingMode.AntiAlias;using(var pen=new Pen(Color.Black,3))g.DrawEllipse(pen,x-4,y-4,8,8);using(var pen=new Pen(Color.White,1))g.DrawEllipse(pen,x-4,y-4,8,8);
        }
        ControlPaint.DrawBorder(g,ClientRectangle,Focused?AppTheme.Accent:Color.FromArgb(47,63,76),ButtonBorderStyle.Solid);
    }
}

// The only captured image is a live 9x9 patch. This small, inert popup never
// replaces the desktop; the scoped hook consumes only the selection click.
sealed class ScreenColorSampler : Form {
    delegate IntPtr MouseProc(int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SetWindowsHookEx(int id,MouseProc proc,IntPtr module,uint thread);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc,int x,int y);
    [DllImport("dwmapi.dll")] static extern int DwmFlush();
    readonly Control owner;readonly MouseProc callback;
#if SELF_TEST
    readonly Func<Point,Color?> read;
#endif
    readonly System.Windows.Forms.Timer pulse=new System.Windows.Forms.Timer{Interval=33};
    readonly Bitmap pixels=new Bitmap(9,9);readonly int started=Environment.TickCount;
    IntPtr hook;int button;Point selected;bool queued,disposed;
    internal Color? CurrentColor{get;private set;}
    internal bool Active{get{return !disposed&&hook!=IntPtr.Zero;}}
    internal event Action<Color?> Completed;
#if SELF_TEST
    internal ScreenColorSampler(Control owner,Func<Point,Color?> reader=null,bool installHook=true){this.owner=owner;read=reader??ReadPixel;callback=Hook;if(installHook)Start();}
#else
    internal ScreenColorSampler(Control owner){this.owner=owner;callback=Hook;Start();}
#endif
    void Start(){
        try{
        FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;AutoScaleMode=AutoScaleMode.None;ClientSize=new Size(110,126);Font=owner.Font;BackColor=AppTheme.Field;ForeColor=AppTheme.Text;Owner=owner as Form;TopMost=true;Enabled=false;DoubleBuffered=true;
        hook=SetWindowsHookEx(14,callback,GetModuleHandle(null),0);if(hook==IntPtr.Zero)throw new System.ComponentModel.Win32Exception();
        pulse.Tick+=RefreshPreview;RefreshPreview(null,EventArgs.Empty);Show();Native.EnableWindow(Handle,false);pulse.Start();
        }catch{Dispose();throw;}
    }
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x080800a0;return p;}}
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);Native.SetLayeredWindowAttributes(Handle,0,255,2);}
    protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}base.WndProc(ref m);}
    internal static Color? ReadPixel(Point point){
        if(!SystemInformation.VirtualScreen.Contains(point))return null;
        IntPtr dc=GetDC(IntPtr.Zero);if(dc==IntPtr.Zero)return null;
        try{uint rgb=GetPixel(dc,point.X,point.Y);return rgb==0xffffffff?(Color?)null:Color.FromArgb((int)(rgb&255),(int)((rgb>>8)&255),(int)((rgb>>16)&255));}finally{ReleaseDC(IntPtr.Zero,dc);}
    }
    void RefreshPreview(object sender,EventArgs e){
        if(disposed)return;if(unchecked(Environment.TickCount-started)>=30000){Cancel();return;}
        Point point;if(Native.GetCursorPos(out point))PreviewAt(point);
    }
    internal void PreviewAt(Point point){
        if(disposed)return;bool covered=Visible&&Bounds.IntersectsWith(new Rectangle(point.X-4,point.Y-4,9,9));if(covered){Hide();DwmFlush();}var screen=Screen.FromPoint(point);Location=Place(point,screen.WorkingArea,Size);CurrentColor=ReadPixel(point);
        var source=Rectangle.Intersect(new Rectangle(point.X-4,point.Y-4,9,9),screen.Bounds);
        using(var g=Graphics.FromImage(pixels)){g.Clear(Color.Black);try{if(!source.IsEmpty)g.CopyFromScreen(source.Location,new Point(source.Left-point.X+4,source.Top-point.Y+4),source.Size,CopyPixelOperation.SourceCopy);}catch{}}
        if(covered)Show();Invalidate();
    }
    internal static Point Place(Point point,Rectangle bounds,Size size){
        int x=point.X+20,y=point.Y+20;if(x+size.Width>bounds.Right)x=point.X-size.Width-20;if(y+size.Height>bounds.Bottom)y=point.Y-size.Height-20;
        return new Point(Math.Max(bounds.Left,Math.Min(bounds.Right-size.Width,x)),Math.Max(bounds.Top,Math.Min(bounds.Bottom-size.Height,y)));
    }
    protected override void OnPaint(PaintEventArgs e){
        var g=e.Graphics;g.InterpolationMode=InterpolationMode.NearestNeighbor;g.PixelOffsetMode=PixelOffsetMode.Half;g.DrawImage(pixels,new Rectangle(10,10,90,90),0,0,9,9,GraphicsUnit.Pixel);
        using(var pen=new Pen(Color.Black,3))g.DrawRectangle(pen,50,50,10,10);using(var pen=new Pen(Color.White))g.DrawRectangle(pen,50,50,10,10);
        Color color=CurrentColor??Color.Black;using(var brush=new SolidBrush(color))g.FillRectangle(brush,10,107,14,12);using(var pen=new Pen(AppTheme.Border))g.DrawRectangle(pen,10,107,14,12);
        TextRenderer.DrawText(g,CurrentColor.HasValue?"#"+(color.ToArgb()&0xffffff).ToString("X6"):"------",Font,new Rectangle(29,104,77,18),ForeColor,TextFormatFlags.Left|TextFormatFlags.VerticalCenter|TextFormatFlags.NoPadding);
        ControlPaint.DrawBorder(g,ClientRectangle,AppTheme.Border,ButtonBorderStyle.Solid);
    }
    IntPtr Hook(int code,IntPtr message,IntPtr data){
        if(code>=0){int kind=message.ToInt32();if(kind==0x201||kind==0x202||kind==0x204||kind==0x205){var point=(Point)Marshal.PtrToStructure(data,typeof(Point));if(ProcessMouse(kind,point))return new IntPtr(1);}}
        return CallNextHookEx(hook,code,message,data);
    }
    internal bool ProcessMouse(int kind,Point point){
        if(disposed||queued)return false;
        if(button==0&&(kind==0x201||kind==0x204)){var form=owner as Form;if(form!=null&&form.Visible&&form.Bounds.Contains(point))return false;button=kind;selected=point;return true;}
        if(button!=0&&kind==button)return true;
        if(button!=0&&kind==button+1){queued=true;owner.BeginInvoke((MethodInvoker)FinishSelection);return true;}
        return false;
    }
    void FinishSelection(){
        if(disposed)return;bool covered=Visible&&Bounds.Contains(selected);Hide();if(covered)DwmFlush();Color? color=null;try{if(button==0x201){
#if SELF_TEST
            color=read(selected);
#else
            color=ReadPixel(selected);
#endif
        }}catch{color=null;}Finish(color);
    }
    void Finish(Color? color){if(disposed)return;Dispose();var completed=Completed;if(completed!=null)completed(color);}
    internal void Cancel(){Finish(null);}
    protected override void Dispose(bool disposing){if(disposing&&!disposed){disposed=true;pulse.Stop();pulse.Dispose();if(hook!=IntPtr.Zero){UnhookWindowsHookEx(hook);hook=IntPtr.Zero;}pixels.Dispose();}base.Dispose(disposing);}
}

sealed class ColorEditor : Form {
    public Color Value{get;private set;}
    internal readonly TextBox Hex=new TextBox();internal readonly NumberField[] Channels=new NumberField[3];
    internal readonly Button Eyedropper=new EyedropperButton(),Confirm,Cancel;
    internal readonly ColorPlane Plane=new ColorPlane(false),BrightnessStrip=new ColorPlane(true);
    internal ScreenColorSampler ActiveSampler{get;private set;}
    readonly Panel preview=new Panel();bool updating;
    public ColorEditor(Color value){
        Text="色彩";ClientSize=new Size(312,348);FormBorderStyle=FormBorderStyle.FixedDialog;MaximizeBox=false;MinimizeBox=false;ShowInTaskbar=false;StartPosition=FormStartPosition.CenterParent;BackColor=AppTheme.Back;ForeColor=AppTheme.Text;Font=new Font("Microsoft JhengHei UI",10);AutoScaleDimensions=new SizeF(96,96);AutoScaleMode=AutoScaleMode.Dpi;
        HandleCreated+=(s,e)=>AppTheme.DarkTitle(Handle);
        Plane.SetBounds(16,16,250,168);BrightnessStrip.SetBounds(280,16,16,168);Controls.Add(Plane);Controls.Add(BrightnessStrip);
        var codeFrame=FieldFrame(16,200,280,36);
        preview.SetBounds(10,10,16,16);preview.AccessibleName="選色預覽";preview.Paint+=(s,e)=>{using(var brush=new SolidBrush(Value))e.Graphics.FillRectangle(brush,preview.ClientRectangle);};codeFrame.Controls.Add(preview);
        Hex.AutoSize=false;Hex.SetBounds(36,8,203,22);Hex.BackColor=AppTheme.Field;Hex.ForeColor=AppTheme.Text;Hex.BorderStyle=BorderStyle.None;Hex.AccessibleName="HEX色碼";codeFrame.Controls.Add(Hex);
        Eyedropper.SetBounds(247,1,32,34);Eyedropper.AccessibleName="螢幕取色";codeFrame.Controls.Add(Eyedropper);
        var rgbFrame=FieldFrame(16,248,280,36);rgbFrame.Paint+=(s,e)=>{using(var pen=new Pen(Color.FromArgb(47,63,76))){e.Graphics.DrawLine(pen,93,7,93,29);e.Graphics.DrawLine(pen,186,7,186,29);}};
        for(int i=0;i<3;i++){
            var label=new Label{Text=new[]{"R","G","B"}[i],ForeColor=AppTheme.Muted,TextAlign=ContentAlignment.MiddleLeft};label.SetBounds(10+i*93,1,16,34);rgbFrame.Controls.Add(label);
            Channels[i]=AppTheme.Number(0,255,0);Channels[i].AccessibleName=new[]{"紅","綠","藍"}[i];Channels[i].SetBounds(34+i*93,8,50,22);rgbFrame.Controls.Add(Channels[i]);
            Channels[i].ValueChanged+=(s,e)=>{if(!updating)SetColor(Color.FromArgb((int)Channels[0].Value,(int)Channels[1].Value,(int)Channels[2].Value));};Channels[i].TextChanged+=(s,e)=>{if(!updating)Valid();};
        }
        Confirm=AppTheme.Button("確定",()=>{if(Valid())DialogResult=DialogResult.OK;},true);Confirm.SetBounds(164,300,132,32);Cancel=AppTheme.Button("取消",()=>DialogResult=DialogResult.Cancel);Cancel.SetBounds(16,300,132,32);Controls.Add(Confirm);Controls.Add(Cancel);AcceptButton=Confirm;CancelButton=Cancel;
        Plane.Changed+=(s,e)=>SetColor(ColorAlgorithm.HslColor(Plane.Hue,Plane.Saturation,Plane.Brightness),false,true);
        BrightnessStrip.Changed+=(s,e)=>{Plane.Brightness=BrightnessStrip.Brightness;SetColor(ColorAlgorithm.HslColor(Plane.Hue,Plane.Saturation,Plane.Brightness),false,true);};
        Hex.TextChanged+=(s,e)=>{if(updating)return;Color color;if(ColorSelection.TryHex(Hex.Text,out color))SetColor(color,true);Valid();};
        Eyedropper.Click+=(s,e)=>PickScreen();SetColor(value);
    }
    Panel FieldFrame(int x,int y,int width,int height){var frame=new Panel{BackColor=AppTheme.Field};frame.SetBounds(x,y,width,height);frame.Paint+=(s,e)=>ControlPaint.DrawBorder(e.Graphics,frame.ClientRectangle,Color.FromArgb(47,63,76),ButtonBorderStyle.Solid);Controls.Add(frame);return frame;}
    bool Valid(){Color color;bool hexValid=ColorSelection.TryHex(Hex.Text,out color),valid=hexValid;foreach(var channel in Channels){int number;valid=valid&&int.TryParse(channel.Text,out number)&&number>=0&&number<=255;}Confirm.Enabled=valid;Hex.ForeColor=hexValid?AppTheme.Text:Color.FromArgb(255,145,145);return valid;}
    internal void SetColor(Color color,bool fromHex=false,bool fromPlane=false){
        if(ActiveSampler!=null)ActiveSampler.Cancel();updating=true;try{Value=Color.FromArgb(255,color.R,color.G,color.B);if(!fromHex)Hex.Text="#"+Value.R.ToString("X2")+Value.G.ToString("X2")+Value.B.ToString("X2");Channels[0].Value=Value.R;Channels[1].Value=Value.G;Channels[2].Value=Value.B;
            if(!fromPlane){if(Value.R!=Value.G||Value.G!=Value.B)Plane.Hue=Value.GetHue()/360;Plane.Saturation=Value.GetSaturation();Plane.Brightness=Value.GetBrightness();}
            BrightnessStrip.Hue=Plane.Hue;BrightnessStrip.Saturation=Plane.Saturation;BrightnessStrip.Brightness=Plane.Brightness;Plane.Invalidate();BrightnessStrip.Invalidate();preview.Invalidate();Valid();
        }finally{updating=false;}
    }
    void PickScreen(){
        if(ActiveSampler!=null){ActiveSampler.Cancel();return;}
        try{ActiveSampler=new ScreenColorSampler(this);ActiveSampler.Completed+=Picked;Eyedropper.BackColor=AppTheme.Selected;Cursor=Cursors.Cross;}
        catch{if(ActiveSampler!=null){ActiveSampler.Dispose();ActiveSampler=null;}
#if SELF_TEST
            throw;
#endif
        }
    }
    void Picked(Color? color){ActiveSampler=null;if(IsDisposed)return;Eyedropper.BackColor=AppTheme.Field;Cursor=Cursors.Default;if(color.HasValue)SetColor(color.Value);}
    protected override bool ProcessCmdKey(ref Message msg,Keys key){if(ActiveSampler!=null&&key==Keys.Escape){ActiveSampler.Cancel();return true;}return base.ProcessCmdKey(ref msg,key);}
    protected override void OnDeactivate(EventArgs e){base.OnDeactivate(e);if(ActiveSampler!=null)ActiveSampler.Cancel();}
    protected override void Dispose(bool disposing){if(disposing&&ActiveSampler!=null){ActiveSampler.Dispose();ActiveSampler=null;}base.Dispose(disposing);}
}
