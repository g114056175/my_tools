"""Prepare public first-release documentation from a captured review.

Development captures may contain experiment history; public Markdown describes
the released application and its comparison with the official game only.
"""
import hashlib
import json
from pathlib import Path


def prepare_docs(project: Path, build: dict) -> None:
    target = project / 'docs/comparison'
    tests = json.loads((target / 'analysis/04_verification/test.json').read_text(encoding='utf-8-sig'))
    gpu = json.loads((target / 'analysis/04_verification/click-wave.json').read_text(encoding='utf-8-sig'))
    performance = json.loads((target / 'analysis/04_verification/performance.json').read_text(encoding='utf-8-sig'))
    active = next(p for p in performance['phases'] if p['phase'] == 'active-default')
    size = f"{build['exeBytes']/1024:.1f}KB"
    import re
    readme = project / 'README.md'
    text = re.sub(r'下載 EXE（[^）]+）', f'下載 EXE（{size}）', readme.read_text(encoding='utf8'))
    readme.write_text(text, encoding='utf8')
    for name in ['performance-before-optimization.json', 'optimization-comparison.json']:
        (target / 'analysis/04_verification' / name).unlink(missing_ok=True)
    comparison = '''# 官方與游標光效對比

左側為《蔚藍檔案》官方錄影，右側為正式版的實際GPU畫面合成至參考背景。顏色、圓弧消散與隨機碎片仍有差異；0ms是官方首個可見效果幀，不是輸入時間。

## 單次點擊，8倍慢速

![官方與正式版單次點擊同步對比](03_comparison-8x.gif)

官方使用f27–62，共36幀；两側共用時間軸，碎片位置及圓弧初始方向未配對。

## 快速連點，4倍慢速

![官方與正式版連點同步對比](analysis/02_continuous/04_official-native-rapid-4x.gif)

官方使用f132–219，依可見點擊幀同步重播，包含官方影片中的前次點擊殘留。間隔約150–333ms，並非固定50ms的高速連點；可見幀不等同OS輸入時間。

[連點關鍵幀](analysis/02_continuous/04_official-native-rapid-keyframes.png) · [時間序列與素材來源](analysis/02_continuous/official-existing-rapid.json)

## 逐幀關鍵畫面

![官方與正式版關鍵幀](04_comparison-keyframes.png)

![最初100ms，每16.7ms一幀](05_comparison-first100ms.png)

[全部36幀](analysis/01_click/00_README.md) · [16／33／133／166／333／450ms集中檢視](analysis/01_click/07_early-and-dissolve.png) · [50／83／100ms集中檢視](analysis/01_click/08_50-83-100ms.png)

官方HDR、影片壓縮與背景混色會影響外觀，正式版在桌面SDR環境作近似模擬；對照不是端到端延遲量測。

<details>
<summary><strong>正式版實作觀察與驗證（展開）</strong></summary>

波紋基準半徑60px，使用透明混合；連點白光來自各次出生閃光的殘留疊加。外環由重疊圓弧逆時針旋轉並呈月牙消散。碎片先長大、轉色、三次明暗回升，再縮小淡出。

[連點、拖曳與碎片觀察](analysis/00_README.md) · [模板色值與166ms畫面](analysis/05_palettes/00_README.md) · [五種碎片樣式](analysis/06_shapes/00_README.md)

正式版通過27項功能與15組GPU检查、獨立啟動與Defender掃描。預設每幀CPU送出平均約0.97ms、幀間隔p95約18.1ms，僅為短時取樣；不代表輸入至顯示延遲。

[完整驗證](analysis/04_verification/verification.json) · [正式版建置紀錄](analysis/04_verification/build-info.json) · [正式版效能量測](analysis/04_verification/performance.json)

</details>
'''.replace('两側', '兩側').replace('检查', '檢查')
    for name in ['README.md', 'comparison.md']:
        content = comparison.replace('27項功能與15組GPU', f"{len(tests['checks'])}項功能與{len(gpu['checks'])}組GPU")
        content = content.replace('0.97ms', f"{active['frames']['drawMeanMs']:.2f}ms").replace('18.1ms', f"{active['frames']['frameP95Ms']:.1f}ms")
        (target / name).write_text(content, encoding='utf8')
    (target / '00_README.md').write_text('''# 官方與正式版效果索引

[同步GIF與關鍵幀](comparison.md)

| 內容 | 檔案 |
| --- | --- |
| 官方單次點擊，8倍慢速 | [官方GIF](01_official-8x.gif) |
| 正式版單次點擊，8倍慢速 | [正式版GIF](02_native-8x.gif) |
| 單次點擊同步對比 | [同步GIF](03_comparison-8x.gif) |
| 快速連點同步對比，4倍慢速 | [同步GIF](analysis/02_continuous/04_official-native-rapid-4x.gif) |
| 12個關鍵時間 | [關鍵幀](04_comparison-keyframes.png) |
| 最初100ms | [逐幀畫面](05_comparison-first100ms.png) |

[全部36幀](analysis/01_click/00_README.md) · [連點、拖曳與碎片](analysis/00_README.md) · [七種模板](analysis/05_palettes/00_README.md) · [五種碎片](analysis/06_shapes/00_README.md) · [完整驗證](analysis/04_verification/verification.json)

官方使用60FPS錄影，正式版使用GPU捕捉並合成至參考背景。相對時間從首個可見畫面計算，隨機配置未配對。
''', encoding='utf8')
    (project / 'CHANGELOG.md').write_text(f'''# 發布紀錄

## 首次正式發布：游標光效

- 按住左鍵拖曳顯示光跡，點擊產生出生白光、波紋、重疊圓弧與碎片；碎片角度獨立隨機，保留同側群聚與部分重疊，近乎同位時才做有限候選比較。
- 七種配色及自訂色，支援統一配色或分別設定軌跡／圓環、波紋與碎片。
- 點選色碼開啟深色選色視窗，整合左側色相／飽和度、右側亮度、HEX／RGB與即時螢幕滴管；取色時保留面板，游標旁顯示局部放大鏡及色碼；確定才套用，取消保留原色。
- 三角形、心形、箭頭、星星、閃電五種碎片，選單顯示圖示及文字。
- 五項效果數值：軌跡粗細、衰退時間、生成間距、點擊大小與碎片大小。
- 單檔EXE，Windows 10（1703以上）／11 x64，需.NET Framework 4.8；設定自動保存，面板可隱藏至托盤。

正式EXE：**{size}（{build['exeBytes']:,} bytes）**，SHA-256開頭 **`{build['exeSha256'][:16]}`**。[完整建置紀錄](docs/comparison/analysis/04_verification/build-info.json)

通過{len(tests['checks'])}項功能、{len(gpu['checks'])}組GPU檢查、獨立啟動及Defender掃描。[操作展示](README.md) · [正式版與官方效果對比](docs/comparison/README.md)
''', encoding='utf8')
    preview = project / 'Preview.md'
    preview.write_text('''# 游標光效預覽

[操作與配色展示](README.md) · [首次正式發布](CHANGELOG.md)

![拖曳、點擊與五種碎片](docs/capture.gif)

![色系與效果面板](docs/control-panel.png)

<details>
<summary><strong>與官方效果對比（展開）</strong></summary>

左官方、右正式版。單次點擊8倍慢速：

![單次點擊同步對比](docs/comparison/03_comparison-8x.gif)

連點4倍慢速，依官方可見幀重播，間隔約150–333ms：

![連點同步對比](docs/comparison/analysis/02_continuous/04_official-native-rapid-4x.gif)

![逐幀關鍵畫面](docs/comparison/04_comparison-keyframes.png)

[完整對照與素材來源](docs/comparison/README.md)

</details>
''', encoding='utf8')
    replacements = {
        '本次新版100%採60px波紋基準，約為上一版100%的86.6%，依指定縮小預設。官方沿用既有錄影，因此此對照的尺寸差異包含這次有意縮小的部分。': '正式版100%採60px波紋基準，與官方錄影的尺寸可能不同。',
        '新版下一幀已轉藍，不再額外停留一幀白光；': '正式版從出生白光逐漸轉為藍色波紋；',
        '新版移除高頻細碎缺口，弧段邊端平滑淡出；': '正式版弧段邊端逐漸收窄並淡出；',
        '新版亮弧維持時間延長，這段仍可辨識；': '正式版亮弧在這段仍可辨識；',
        '碎片基準由1.8取整至2.2，新100%約為舊122.2%。': '碎片大小基準為2.2。',
        '碎片大小基準由1.8取整至2.2，新的100%為上一版的122.2%；使用者保存的百分比仍有效。': '碎片大小基準為2.2，按使用者指定百分比縮放。',
        '灰色已從模板清單移除，既有灰色設定仍可作為自訂色保留。': '其他顏色可使用自訂色。',
        '波紋不透明度為修正前的80%；夕霞橙改為偏黃的': '波紋不透明度倍率為0.80；夕霞橙主色為偏黃的',
        '本次波紋明度下調約0.02、飽和度倍率0.70→0.78，透明度保持0.80。碎片明度小降、飽和度略增；純黑獨立保留RGB0，早期出生白光仍保留。': '波紋色由主色提高明度並調整飽和度，不透明度倍率為0.80。碎片色較波紋深；水墨黑轉色後保留RGB0，出生時仍有白光。',
        '新版光暈只繪在三角外側': '正式版光暈只繪在碎片外側',
        '保留前次點擊歷史': '保留官方影片中的前次點擊殘留',
        '沒有增加方向或光暈的調整項。': '方向及光暈使用固定規則。',
        '## 未來開發紀錄': '## 未來方向',
        '[擴充紀錄]': '[擴充說明]',
        '新版': '正式版',
        '貓掌等': '',
        '貓掌印及其他點擊效果': '其他點擊效果',
    }
    for page in [project / 'docs/fragment-shapes.md', *target.rglob('*.md')]:
        text = page.read_text(encoding='utf8')
        for before, after in replacements.items():
            text = text.replace(before, after)
        page.write_text(text, encoding='utf8')


def write_manifest(project: Path, build: dict) -> dict:
    target = project / 'docs/comparison'
    manifest = {'productionSha256': build['exeSha256'], 'scope': 'formal release and official comparison', 'files': []}
    for file in sorted(target.rglob('*')):
        if file.is_file() and file.name != 'manifest.json':
            manifest['files'].append({'path': file.relative_to(target).as_posix(), 'bytes': file.stat().st_size, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    (target / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    return manifest


if __name__ == '__main__':
    project = Path(__file__).resolve().parents[1]
    build = json.loads((project / 'dist/build-info.json').read_text(encoding='utf-8-sig'))
    prepare_docs(project, build)
    write_manifest(project, build)
