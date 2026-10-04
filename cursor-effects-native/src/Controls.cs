using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class AppTheme {
    public static readonly Color Back=Color.FromArgb(13,20,29), Card=Color.FromArgb(32,48,63), Field=Color.FromArgb(9,21,33), Text=Color.FromArgb(248,251,255), Muted=Color.FromArgb(195,214,228), Accent=Color.FromArgb(110,240,233), Border=Color.FromArgb(116,151,172), Rail=Color.FromArgb(111,146,166), Selected=Color.FromArgb(39,83,103);
    public static readonly Icon Icon=System.Drawing.Icon.ExtractAssociatedIcon(Application.ExecutablePath);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attribute,ref int value,int size);
    public static void DarkTitle(IntPtr hwnd){int enabled=1;DwmSetWindowAttribute(hwnd,20,ref enabled,4);}
    public static Button Button(string text,Action action,bool primary=false){
        var b=new Button{Text=text,Size=new Size(92,34),FlatStyle=FlatStyle.Flat,BackColor=primary?Color.FromArgb(46,99,104):Field,ForeColor=Text,Margin=Padding.Empty,Cursor=Cursors.Hand};
        b.FlatAppearance.BorderColor=primary?Accent:Border;b.FlatAppearance.MouseOverBackColor=Color.FromArgb(42,72,88);b.Click+=(s,e)=>action();return b;
    }
    public static CheckBox Check(string text,bool value){return new AccentCheckBox{Text=text,Checked=value,AutoSize=true,BackColor=Card,ForeColor=Text,Margin=new Padding(0,6,18,6),Cursor=Cursors.Hand};}
    public static FlowLayoutPanel Group(params Control[] items){var p=new FlowLayoutPanel{Dock=DockStyle.Fill,Height=34,WrapContents=false,Margin=Padding.Empty,BackColor=Card};p.Controls.AddRange(items);return p;}
    public static NumberField Number(int min,int max,int value){return new NumberField{Minimum=min,Maximum=max,Value=value,AutoSize=false,Size=new Size(60,20),BorderStyle=BorderStyle.None,BackColor=Field,ForeColor=Text,TextAlign=HorizontalAlignment.Right,Margin=Padding.Empty};}
    public static Control Slider(NumberField number){
        var row=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Height=36,Margin=Padding.Empty,BackColor=Card};row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,76));row.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var slider=new PositionSlider{Minimum=(int)number.Minimum,Maximum=(int)number.Maximum,Value=(int)number.Value,Dock=DockStyle.Fill,Height=32,Margin=new Padding(0,0,12,0),BackColor=Card};
        slider.ValueChanged+=(s,e)=>{if(number.Value!=slider.Value)number.Value=slider.Value;};number.ValueChanged+=(s,e)=>slider.Value=(int)number.Value;
        var frame=new Panel{BackColor=Field,Size=new Size(76,24),Anchor=AnchorStyles.Right,Margin=Padding.Empty,Padding=new Padding(8,2,8,2)};number.Dock=DockStyle.Fill;frame.Controls.Add(number);
        frame.Paint+=(s,e)=>ControlPaint.DrawBorder(e.Graphics,frame.ClientRectangle,Border,ButtonBorderStyle.Solid);
        row.Controls.Add(slider,0,0);row.Controls.Add(frame,1,0);return row;
    }
}

sealed class AccentCheckBox : CheckBox {
    public AccentCheckBox(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);}
    int BoxSize{get{return (int)Math.Round(16.0*DeviceDpi/96);}}
    public override Size GetPreferredSize(Size proposedSize){var text=TextRenderer.MeasureText(Text,Font);return new Size(BoxSize+8+text.Width,Math.Max(BoxSize,text.Height)+4);}
    protected override void OnPaint(PaintEventArgs e){
        var g=e.Graphics;g.Clear(BackColor);int size=BoxSize;var box=new Rectangle(1,(Height-size)/2,size-1,size-1);
        using(var fill=new SolidBrush(Checked?AppTheme.Accent:AppTheme.Field))g.FillRectangle(fill,box);
        using(var border=new Pen(Checked?AppTheme.Accent:AppTheme.Border))g.DrawRectangle(border,box);
        if(Checked){g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;using(var pen=new Pen(AppTheme.Back,Math.Max(2,size*.13f)))g.DrawLines(pen,new[]{new PointF(box.X+size*.2f,box.Y+size*.5f),new PointF(box.X+size*.42f,box.Y+size*.73f),new PointF(box.X+size*.8f,box.Y+size*.25f)});}
        var label=new Rectangle(size+8,0,Math.Max(0,Width-size-8),Height);TextRenderer.DrawText(g,Text,Font,label,Enabled?ForeColor:AppTheme.Muted,TextFormatFlags.VerticalCenter|TextFormatFlags.Left);
        if(Focused)ControlPaint.DrawFocusRectangle(g,label,AppTheme.Accent,BackColor);
    }
}

// No native spin control, wheel increments, or arrow-key number changes.
sealed class NumberField : TextBox {
    public decimal Minimum,Maximum;decimal current;bool formatting;
    public event EventHandler ValueChanged;
    public decimal Value {get{return current;}set{SetValue(value);FormatValue();}}
    void SetValue(decimal value){value=Math.Round(Math.Max(Minimum,Math.Min(Maximum,value)));if(value==current)return;current=value;if(ValueChanged!=null)ValueChanged(this,EventArgs.Empty);}
    void FormatValue(){string text=current.ToString("F0");if(Text==text)return;formatting=true;Text=text;formatting=false;}
    public void Commit(){decimal value;if(decimal.TryParse(Text,out value))SetValue(value);FormatValue();}
    protected override void OnTextChanged(EventArgs e){base.OnTextChanged(e);decimal value;if(!formatting&&decimal.TryParse(Text,out value)&&value>=Minimum&&value<=Maximum)SetValue(value);}
    protected override void OnLostFocus(EventArgs e){Commit();base.OnLostFocus(e);}
    protected override void OnKeyDown(KeyEventArgs e){if(e.KeyCode==Keys.Enter){Commit();e.Handled=true;e.SuppressKeyPress=true;}else if(e.KeyCode==Keys.Escape){FormatValue();e.Handled=true;e.SuppressKeyPress=true;}base.OnKeyDown(e);}
}

sealed class PositionSlider : Control {
    public int Minimum,Maximum;int current;
    public event EventHandler ValueChanged;
    public int Value {get{return current;}set{value=Math.Max(Minimum,Math.Min(Maximum,value));if(current==value)return;current=value;Invalidate();if(ValueChanged!=null)ValueChanged(this,EventArgs.Empty);}}
    public PositionSlider(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.Selectable,true);TabStop=true;Cursor=Cursors.Hand;AccessibleRole=AccessibleRole.Slider;}
    public int ValueAt(int x){double t=(double)(x-9)/Math.Max(1,ClientSize.Width-18);return Math.Max(Minimum,Math.Min(Maximum,(int)Math.Round(Minimum+t*(Maximum-Minimum))));}
    protected override void OnMouseDown(MouseEventArgs e){base.OnMouseDown(e);if(e.Button==MouseButtons.Left){Focus();Capture=true;Value=ValueAt(e.X);}}
    protected override void OnMouseMove(MouseEventArgs e){base.OnMouseMove(e);if(Capture)Value=ValueAt(e.X);}
    protected override void OnMouseUp(MouseEventArgs e){base.OnMouseUp(e);if(e.Button==MouseButtons.Left&&Capture){Value=ValueAt(e.X);Capture=false;}}
    protected override bool IsInputKey(Keys key){var k=key&Keys.KeyCode;return k==Keys.Left||k==Keys.Right||k==Keys.Home||k==Keys.End||base.IsInputKey(key);}
    protected override void OnKeyDown(KeyEventArgs e){base.OnKeyDown(e);if(e.KeyCode==Keys.Home)Value=Minimum;else if(e.KeyCode==Keys.End)Value=Maximum;else if(e.KeyCode==Keys.Left)Value--;else if(e.KeyCode==Keys.Right)Value++;else return;e.Handled=true;}
    protected override void OnPaint(PaintEventArgs e){
        base.OnPaint(e);var g=e.Graphics;g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;float y=ClientSize.Height/2f,x=9+(ClientSize.Width-18)*(float)(Value-Minimum)/Math.Max(1,Maximum-Minimum);
        using(var rail=new Pen(AppTheme.Rail,4)){rail.StartCap=rail.EndCap=System.Drawing.Drawing2D.LineCap.Round;g.DrawLine(rail,9,y,Math.Max(9,ClientSize.Width-9),y);}
        using(var fill=new Pen(AppTheme.Accent,4))g.DrawLine(fill,9,y,x,y);using(var dot=new SolidBrush(AppTheme.Accent))g.FillEllipse(dot,x-5,y-5,10,10);
        if(Focused)using(var p=new Pen(AppTheme.Muted))g.DrawEllipse(p,x-8,y-8,16,16);
    }
}

sealed class OnOffSwitch : CheckBox {
    public OnOffSwitch(){SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer,true);AutoSize=false;Size=new Size(110,30);Cursor=Cursors.Hand;AccessibleName="效果開關";AccessibleRole=AccessibleRole.CheckButton;}
    protected override void OnPaint(PaintEventArgs e){
        var g=e.Graphics;g.Clear(BackColor);g.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        float h=24*DeviceDpi/96f,w=44*DeviceDpi/96f,x=Width-w-2,y=(Height-h)/2;
        using(var path=new System.Drawing.Drawing2D.GraphicsPath()){
            path.AddArc(x,y,h,h,90,180);path.AddArc(x+w-h,y,h,h,270,180);path.CloseFigure();
            using(var fill=new SolidBrush(Checked?Color.FromArgb(32,145,148):AppTheme.Field))g.FillPath(fill,path);
            using(var pen=new Pen(Checked?AppTheme.Accent:AppTheme.Border,1))g.DrawPath(pen,path);
        }
        float inset=h/6,thumb=h-2*inset,tx=Checked?x+w-h+inset:x+inset;using(var fill=new SolidBrush(Checked?AppTheme.Text:AppTheme.Muted))g.FillEllipse(fill,tx,y+inset,thumb,thumb);
        var label=new Rectangle(0,0,(int)x-8,Height);
        TextRenderer.DrawText(g,Checked?"開啟":"關閉",Font,label,Checked?AppTheme.Accent:AppTheme.Muted,TextFormatFlags.Right|TextFormatFlags.VerticalCenter|TextFormatFlags.NoPadding);
        if(Focused)ControlPaint.DrawFocusRectangle(g,ClientRectangle,AppTheme.Text,BackColor);
    }
}

sealed class ColorField : Button {
    Color current;public event EventHandler ColorChanged;
    public Color Value{get{return current;}set{value=Color.FromArgb(255,value.R,value.G,value.B);if(value.ToArgb()==current.ToArgb())return;current=value;Text="#"+value.R.ToString("X2")+value.G.ToString("X2")+value.B.ToString("X2");AccessibleDescription=Text;Invalidate();if(ColorChanged!=null)ColorChanged(this,EventArgs.Empty);}}
    public ColorField(Color value){Dock=DockStyle.Fill;FlatStyle=FlatStyle.Flat;FlatAppearance.BorderColor=AppTheme.Border;BackColor=AppTheme.Field;ForeColor=AppTheme.Text;TextAlign=ContentAlignment.MiddleRight;Padding=new Padding(30,0,8,0);Cursor=Cursors.Hand;Margin=Padding.Empty;Value=value;}
    protected override void OnClick(EventArgs e){base.OnClick(e);using(var picker=new ColorDialog{Color=Value,FullOpen=true,AnyColor=true})if(picker.ShowDialog(FindForm())==DialogResult.OK)Value=picker.Color;}
    protected override void OnPaint(PaintEventArgs e){base.OnPaint(e);int size=Math.Min(16*DeviceDpi/96,Height-8);var r=new Rectangle(9,(Height-size)/2,size,size);using(var brush=new SolidBrush(current))e.Graphics.FillRectangle(brush,r);using(var pen=new Pen(AppTheme.Text))e.Graphics.DrawRectangle(pen,r);}
}

sealed class ColorPalette {
    public readonly string Name;public readonly Color Trail,Ripple,Fragment;
    public ColorPalette(string name,int trail,int ripple,int fragment){Name=name;Trail=Rgb(trail);Ripple=Rgb(ripple);Fragment=Rgb(fragment);}
    static Color Rgb(int rgb){return Color.FromArgb(255,(rgb>>16)&255,(rgb>>8)&255,rgb&255);}
    public static readonly ColorPalette[] All={
        new ColorPalette("蔚藍檔案",0x45edff,0x45edff,0xc4fcff),
        new ColorPalette("星夜紫",0xb087ff,0x8c67ef,0xf3e8ff),
        new ColorPalette("櫻花粉",0xef83ad,0xdb5a91,0xffe1ec),
        new ColorPalette("薄荷綠",0x42dca1,0x22b889,0xd1ffe9),
        new ColorPalette("暖金琥珀",0xffbe55,0xe79a32,0xfff0ca),
        new ColorPalette("珊瑚夕霞",0xff8a6c,0xec6177,0xffdbb0)
    };
}

sealed class PaletteField : ComboBox {
    public PaletteField(){DropDownStyle=ComboBoxStyle.DropDownList;DrawMode=DrawMode.OwnerDrawFixed;FlatStyle=FlatStyle.Flat;BackColor=AppTheme.Field;ForeColor=AppTheme.Text;Dock=DockStyle.Fill;ItemHeight=24;AccessibleName="配色模板";Items.Add("自訂");foreach(var palette in ColorPalette.All)Items.Add(palette.Name);}
    protected override void OnDrawItem(DrawItemEventArgs e){
        if(e.Index<0)return;var selected=(e.State&DrawItemState.Selected)!=0;using(var brush=new SolidBrush(selected?AppTheme.Selected:AppTheme.Field))e.Graphics.FillRectangle(brush,e.Bounds);
        int size=12*DeviceDpi/96,gap=4*DeviceDpi/96;var text=e.Bounds;text.X+=6;text.Width-=e.Index>0?3*(size+gap)+12:12;TextRenderer.DrawText(e.Graphics,Items[e.Index].ToString(),Font,text,AppTheme.Text,TextFormatFlags.Left|TextFormatFlags.VerticalCenter|TextFormatFlags.EndEllipsis);
        if(e.Index>0){var p=ColorPalette.All[e.Index-1];var colors=new[]{p.Trail,p.Ripple,p.Fragment};for(int i=0;i<3;i++){var r=new Rectangle(e.Bounds.Right-6-(3-i)*(size+gap),e.Bounds.Top+(e.Bounds.Height-size)/2,size,size);using(var brush=new SolidBrush(colors[i]))e.Graphics.FillRectangle(brush,r);}}
        e.DrawFocusRectangle();
    }
}

sealed class ControlsWindow : Form {
    readonly CursorHost host;
    public readonly NumberField OpacityValue=AppTheme.Number(0,100,100),Strength=AppTheme.Number(0,300,100),EffectSize=AppTheme.Number(25,300,100),ParticleStrength=AppTheme.Number(0,300,100);
    public readonly NumberField TrailFragmentSize=AppTheme.Number(25,300,100),RippleSize=AppTheme.Number(25,300,100),ClickFragmentSize=AppTheme.Number(25,300,100),ClickOpacity=AppTheme.Number(0,100,100);
    public readonly NumberField ParticleSpeed=AppTheme.Number(0,300,100),TrailSpread=AppTheme.Number(0,300,100);
    public readonly ColorField TrailColor=new ColorField(Color.FromArgb(69,237,255)),RippleColor=new ColorField(Color.FromArgb(69,237,255)),FragmentColor=new ColorField(Color.FromArgb(196,252,255));
    public readonly OnOffSwitch VisibleValue=new OnOffSwitch{Checked=true};
    public readonly PaletteField Palette=new PaletteField();bool synchronizingPalette;
    public readonly CheckBox Trail=AppTheme.Check("按住左鍵時顯示",true),ClickValue=AppTheme.Check("點擊時顯示",true);
    public readonly Label Status;public bool Updating;
    readonly TableLayoutPanel body;readonly Control[] pages;readonly Button[] tabs;
    public NumberField[] Numbers{get{return new[]{EffectSize,TrailFragmentSize,OpacityValue,RippleSize,ClickFragmentSize,ClickOpacity,ParticleStrength,ParticleSpeed,TrailSpread,Strength};}}
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);AppTheme.DarkTitle(Handle);}
    public void HidePanel(){Hide();}
    public void ShowPanel(){WindowState=FormWindowState.Normal;Show();Activate();}
    public void SelectPage(int selected){for(int i=0;i<pages.Length;i++){pages[i].Visible=i==selected;tabs[i].BackColor=i==selected?AppTheme.Selected:AppTheme.Field;tabs[i].FlatAppearance.BorderColor=i==selected?AppTheme.Accent:AppTheme.Border;}}
    public void SyncPalette(){int selected=0;for(int i=0;i<ColorPalette.All.Length;i++){var p=ColorPalette.All[i];if(p.Trail.ToArgb()==TrailColor.Value.ToArgb()&&p.Ripple.ToArgb()==RippleColor.Value.ToArgb()&&p.Fragment.ToArgb()==FragmentColor.Value.ToArgb()){selected=i+1;break;}}synchronizingPalette=true;try{Palette.SelectedIndex=selected;}finally{synchronizingPalette=false;}}
    public ControlsWindow(CursorHost value){
        host=value;Updating=true;Text="滑鼠光跡";Icon=AppTheme.Icon;StartPosition=FormStartPosition.CenterScreen;FormBorderStyle=FormBorderStyle.FixedSingle;ClientSize=new Size(380,430);MaximizeBox=false;AutoScaleDimensions=new SizeF(96,96);AutoScaleMode=AutoScaleMode.Dpi;
        Font=new Font("Microsoft JhengHei UI",9);BackColor=AppTheme.Back;ForeColor=AppTheme.Text;
        body=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=1,RowCount=5,Padding=new Padding(14),Margin=Padding.Empty};body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));Controls.Add(body);
        foreach(int height in new[]{66,44,36,222,34})body.RowStyles.Add(new RowStyle(SizeType.Absolute,height));
        var master=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,BackColor=AppTheme.Card,Padding=new Padding(14,8,12,8),Margin=new Padding(0,0,0,12)};master.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));master.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,110));master.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        master.Controls.Add(new Label{Text="滑鼠效果",AutoSize=true,Anchor=AnchorStyles.Left,ForeColor=AppTheme.Text,Font=new Font(Font,FontStyle.Bold),Margin=Padding.Empty},0,0);VisibleValue.Dock=DockStyle.Fill;VisibleValue.BackColor=AppTheme.Card;VisibleValue.Margin=Padding.Empty;master.Controls.Add(VisibleValue,1,0);body.Controls.Add(master,0,0);
        var paletteRow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=1,Padding=new Padding(14,0,14,0),BackColor=AppTheme.Card,Margin=new Padding(0,0,0,8)};paletteRow.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,94));paletteRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));paletteRow.RowStyles.Add(new RowStyle(SizeType.Percent,100));paletteRow.Controls.Add(new Label{Text="配色模板",AutoSize=true,Anchor=AnchorStyles.Left,Margin=Padding.Empty},0,0);Palette.Anchor=AnchorStyles.Left|AnchorStyles.Right;Palette.Dock=DockStyle.None;Palette.Margin=Padding.Empty;paletteRow.Controls.Add(Palette,1,0);body.Controls.Add(paletteRow,0,1);
        var tabRow=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3,RowCount=1,Margin=Padding.Empty};tabRow.RowStyles.Add(new RowStyle(SizeType.Percent,100));tabs=new Button[3];var titles=new[]{"拖曳光跡","點擊效果","碎片"};for(int i=0;i<3;i++){int index=i;tabRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100f/3));var tab=AppTheme.Button(titles[i],()=>SelectPage(index));tab.Dock=DockStyle.Fill;tab.Margin=new Padding(i==0?0:3,0,i==2?0:3,4);tabs[i]=tab;tabRow.Controls.Add(tab,i,0);}body.Controls.Add(tabRow,0,2);
        var pageHost=new Panel{Dock=DockStyle.Fill,Margin=new Padding(0,0,0,8)};var drag=Page();Row(drag,"",AppTheme.Group(Trail),34);Row(drag,"光跡顏色",TrailColor,38);Row(drag,"軌跡粗細 %",AppTheme.Slider(EffectSize),38);Row(drag,"碎片大小 %",AppTheme.Slider(TrailFragmentSize),38);Row(drag,"不透明度 %",AppTheme.Slider(OpacityValue),38);
        var click=Page();Row(click,"",AppTheme.Group(ClickValue),34);Row(click,"波紋顏色",RippleColor,38);Row(click,"波紋大小 %",AppTheme.Slider(RippleSize),38);Row(click,"碎片大小 %",AppTheme.Slider(ClickFragmentSize),38);Row(click,"不透明度 %",AppTheme.Slider(ClickOpacity),38);
        var fragments=Page();Row(fragments,"碎片顏色",FragmentColor,38);Row(fragments,"碎片數量 %",AppTheme.Slider(ParticleStrength),38);Row(fragments,"碎片速度 %",AppTheme.Slider(ParticleSpeed),38);Row(fragments,"拖曳分散 %",AppTheme.Slider(TrailSpread),38);Row(fragments,"光暈強度 %",AppTheme.Slider(Strength),38);
        pages=new Control[]{drag,click,fragments};foreach(var page in new[]{drag,click,fragments}){page.RowCount++;page.RowStyles.Add(new RowStyle(SizeType.Percent,100));pageHost.Controls.Add(page);}body.Controls.Add(pageHost,0,3);
        var footer=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=3,RowCount=1,Margin=Padding.Empty};footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,76));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));footer.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,104));footer.RowStyles.Add(new RowStyle(SizeType.Percent,100));
        var reset=AppTheme.Button("重設",()=>host.ResetControls());reset.Dock=DockStyle.Fill;reset.AccessibleName="重設效果";footer.Controls.Add(reset,0,0);Status=new Label{Dock=DockStyle.Fill,ForeColor=AppTheme.Muted,Visible=false,AutoEllipsis=true,TextAlign=ContentAlignment.MiddleLeft,Margin=new Padding(8,0,8,0)};footer.Controls.Add(Status,1,0);var hide=AppTheme.Button("收起面板",HidePanel);hide.Dock=DockStyle.Fill;footer.Controls.Add(hide,2,0);body.Controls.Add(footer,0,4);
        foreach(var n in Numbers)n.ValueChanged+=(s,e)=>Changed();
        foreach(var c in new CheckBox[]{VisibleValue,Trail,ClickValue})c.CheckedChanged+=(s,e)=>Changed();
        foreach(var c in new[]{TrailColor,RippleColor,FragmentColor})c.ColorChanged+=(s,e)=>{if(!Updating)SyncPalette();Changed();};
        Palette.SelectedIndexChanged+=(s,e)=>{if(!synchronizingPalette&&!Updating&&Palette.SelectedIndex>0)host.ApplyPalette(ColorPalette.All[Palette.SelectedIndex-1]);};
        SyncPalette();SelectPage(0);
        FormClosed+=(s,e)=>host.Quit(0);Updating=false;
    }
    void Changed(){if(!Updating){host.UpdateVisibilityMenu();if(!VisibleValue.Checked)host.Configure();else host.ScheduleConfigure();}}
    static TableLayoutPanel Page(){var p=new TableLayoutPanel{Dock=DockStyle.Fill,ColumnCount=2,RowCount=0,Padding=new Padding(14,10,14,10),BackColor=AppTheme.Card,Margin=Padding.Empty};p.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,94));p.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));return p;}
    static void Row(TableLayoutPanel panel,string text,Control control,int height){int r=panel.RowCount++;panel.RowStyles.Add(new RowStyle(SizeType.Absolute,height));panel.Height+=height;if(text.Length>0){panel.Controls.Add(new Label{Text=text,AutoSize=true,Anchor=AnchorStyles.Left,Margin=Padding.Empty},0,r);panel.Controls.Add(control,1,r);control.AccessibleName=text;}else{panel.Controls.Add(control,0,r);panel.SetColumnSpan(control,2);}control.Margin=new Padding(0,3,0,3);}
}

sealed class DarkMenuRenderer : ToolStripProfessionalRenderer {
    public DarkMenuRenderer():base(new MenuColors()){RoundedEdges=false;}
    protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e){e.Graphics.Clear(AppTheme.Card);}
    protected override void OnRenderItemText(ToolStripItemTextRenderEventArgs e){e.TextColor=AppTheme.Text;base.OnRenderItemText(e);}
    protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e){
        var item=e.Item as ToolStripMenuItem;bool selected=e.Item.Selected,chosen=item!=null&&item.Checked;
        using(var brush=new SolidBrush(selected?Color.FromArgb(52,103,123):chosen?AppTheme.Selected:AppTheme.Card))e.Graphics.FillRectangle(brush,new Rectangle(Point.Empty,e.Item.Size));
        if(chosen)using(var brush=new SolidBrush(AppTheme.Accent))e.Graphics.FillRectangle(brush,0,2,3,e.Item.Height-4);
    }
    protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e){
        var r=e.ImageRectangle;float size=Math.Min(r.Width,r.Height),x=r.X,y=r.Y;e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
        using(var pen=new Pen(AppTheme.Accent,Math.Max(2,size*.15f)))e.Graphics.DrawLines(pen,new[]{new PointF(x+size*.15f,y+size*.5f),new PointF(x+size*.4f,y+size*.75f),new PointF(x+size*.85f,y+size*.2f)});
    }
    sealed class MenuColors : ProfessionalColorTable {
        public override Color ToolStripDropDownBackground{get{return AppTheme.Card;}}
        public override Color ImageMarginGradientBegin{get{return AppTheme.Card;}}
        public override Color ImageMarginGradientMiddle{get{return AppTheme.Card;}}
        public override Color ImageMarginGradientEnd{get{return AppTheme.Card;}}
        public override Color MenuItemSelected{get{return AppTheme.Selected;}}
        public override Color MenuItemBorder{get{return AppTheme.Border;}}
        public override Color MenuBorder{get{return AppTheme.Border;}}
        public override Color CheckBackground{get{return AppTheme.Card;}}
        public override Color CheckSelectedBackground{get{return AppTheme.Card;}}
    }
}

