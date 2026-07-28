# Homebridge ECHONET Lite Plus

[GitHub](https://github.com/sylpied/homebridge-echonet-lite-plus) · [Issues](https://github.com/sylpied/homebridge-echonet-lite-plus/issues) · [ECHONET公式MRA](https://echonet.jp/spec_mra_rr3/)

LAN内の ECHONET Lite 機器と直接通信し、HomeKit に公開するHomebridge動的プラットフォームです。MQTTブローカーは不要です。

ECHONET ConsortiumのMachine Readable Appendix Version 1.4.0を同梱し、EPCの名称、アクセス規則、数値型、符号、倍率、状態enumの読書きをMRAから解決します。HomeKitサービスへの割当ては、MRAで変換したプロパティ名を使用します。

MRAデータの著作権はエコーネットコンソーシアムに帰属します。出典およびライセンス適用範囲の詳細は、同梱の[NOTICE-MRA.md](NOTICE-MRA.md)を参照してください。本プラグインのMITライセンスはMRAデータの著作権、ライセンスその他の条件を変更するものではありません。

## HEMSとECHONET Liteの関係

HEMS（Home Energy Management System）は、家庭内の電力・発電量・ガス・水道などを見える化し、家電や住宅設備を管理・制御するシステムです。

ECHONET Liteは、HEMSを構成するコントローラーと、エアコン、照明、給湯器、分電盤などの機器が通信するために広く利用されている共通規格です。そのため、ECHONET Liteという名称を意識していなくても、ご自宅にある「HEMS対応機器」がECHONET Lite対応機器である場合があります。

本プラグインは、LAN内のECHONET Lite対応機器と直接通信し、対応する機能をHomebridge／Appleホームへ橋渡しします。メーカーがApple HomeやHomeKitへ直接対応していないHEMS対応機器でも、ECHONET Liteで通信できる場合は、本プラグインから検出・操作できる可能性があります。

ECHONET Liteの利用先はHEMSだけに限定されません。家電制御、住宅設備管理、セキュリティ、見守りなどにも利用されています。また、本プラグインはECHONET Liteによる機器通信を扱うものであり、エネルギー最適化、料金計算、需要予測などを行うHEMSそのものではありません。

なお、HEMS対応と表示されているすべての機器を操作できるとは限りません。ネットワークへの接続方法、メーカー独自の制限、機器が公開しているECHONET Liteプロパティ、HomeKitで表現可能な機能などによって対応範囲が異なります。

## 動作要件とインストール

- Node.js 18.15以降、20.7以降、22、または24（Homebridgeの対応範囲に準拠）
- Homebridge 1.6以降（Homebridge 2.xを含む）
- HomebridgeとECHONET Lite機器が同じLANからUDP/3610で通信できること

Homebridge UIのプラグイン検索から `homebridge-echonet-lite-plus` をインストールします。npmを直接使用する場合は次のコマンドです。

```sh
npm install -g homebridge-echonet-lite-plus
```

インストール後、プラグイン設定を開いて対象ネットワークを確認し、Child Bridgeを再起動してください。既存バージョンから更新する場合も設定は引き継がれます。

## 対応方針

ECHONET Liteの機器クラスとプロパティを、意味が一致するHomeKitサービスへ割り当てます。HomeKitに対応する型がない計測値を、照度や湿度など別の値へ偽装することはありません。

| ECHONET Lite機器 | EOJ | HomeKitでの扱い |
| --- | --- | --- |
| 家庭用エアコン | `0130` | Heater/Cooler、運転、モード、室温、設定温度 |
| 換気扇・空調換気扇・空気清浄機 | `0133` / `0134` / `0135` | Fan |
| 電動雨戸・シャッター | `0263` | Window Covering、開閉、停止、開度（機器が対応する場合） |
| 電気温水器・瞬間式給湯器 | `026B` / `0272` | 風呂自動Switch |
| 電気錠 | `026F` | Lock Mechanism |
| 浴室暖房乾燥機 | `0273` | Fan、換気・予備暖房・暖房・乾燥・涼風Switch |
| 床暖房 | `027B` | Thermostat、運転、現在温度、設定温度 |
| ハイブリッド給湯機 | `02A6` | 自動沸き上げSwitch |
| JEM-A/HA対応スイッチ | `05FD` | Switch |
| 一般・単機能照明 | `0290` / `0291` | Lightbulb、電源、明るさ |
| 温度・湿度センサー | `0011` / `0012` | 専用センサー |
| 電力量計・分電盤・スマートメーター | `0280` / `0287` / `0288` | Eve互換の電力・電流・積算電力量 |
| 住宅用太陽光発電 | `0279` | 拡張モードで発電電力・積算発電量・積算売電量（読み取り専用） |
| 電気自動車充放電器 | `027E` | 拡張モードで充放電電力・残量・使用電力量（読み取り専用） |
| 水流量メーター | `0281` | 積算水道使用量、検針データ異常。Appleホーム互換モードでは標準Leak Sensorを異常通知の代替表示として使用 |
| ガスメーター | `0282` | 積算ガス使用量 |

Appleのホームアプリには電力・発電量・EV残量・水道・ガス使用量の標準表示がありません。既定のAppleホーム互換モードでは、意味の異なるタイルへ偽装せず非表示にします。拡張モードでは正しい単位のカスタムCharacteristicとして公開し、Eveなど対応するHomeKitアプリから参照できます。

水流量メーターのEPC `E3`は「検針データ異常」であり、漏水そのものを表すプロパティではありません。Appleホームには汎用の検針異常タイルがないため、Appleホーム互換モードに限りLeak Sensorを異常通知の代替表示として使用します。表示上の「漏水検知」は、実際の漏水を断定するものではありません。

ECHONET Liteとして存在していても、HomeKit上で安全かつ自然に表現できない機器クラスは検出一覧にのみ表示し、対応マッピングを実装するまでHomeKitへは公開しません。

### エアコンの設定温度単位

本プラグインは、家庭用エアコンの標準ECHONET Liteプロパティ「温度設定値」（EPC `B3`）に合わせ、設定温度を1℃単位で扱います。EPC `B3`では0.5℃を表現できないため、Appleホーム上で0.5℃単位を選択できるようにしても、その値を標準ECHONET Lite通信でそのまま実機へ送ることはできません。

メーカー独自のローカルAPIなどで0.5℃単位を扱える機器でも、本プラグインは標準ECHONET Lite通信を使用するため1℃単位です。

## 構成

HomebridgeをECHONET Lite機器と同じLANで動かし、設定画面で自動探索を有効にします。複数NIC環境では対象ネットワークを指定してください。

## 設定

- `targetNetwork`: 使用するIPv4ネットワーク。複数NIC環境で指定します。
- `autoDiscovery`: マルチキャストによる機器探索です。
- `knownDeviceIps`: 自動探索へ応答しない機器のIPアドレスです。
- `includeDevices` / `excludeDevices`: IP、EOJ、内部識別子によるフィルターです。
- `deviceSettings`: 検出済み機器ごとのHomeKit公開、表示名、表示・操作項目の選択です。通常はカスタムUIから設定します。
- `meterDisplayMode`: `appleHome`（推奨）はAppleホーム非対応の計測タイルを隠し、`extended`はEveなど対応アプリ向けのカスタム計測値を公開します。
- `pollInterval`: INF通知を送らない機器の状態を定期取得します。既定は60秒、最短は30秒です。大量の機器がある場合は5分または無効を選べます。
- `logLevel`: 通常は `info` を推奨します。

通常ログでは接続、機器追加、HomeKitからの操作、警告、エラーだけを表示します。ECHONET LiteのINF由来を含む頻繁なpushデータと検出詳細は `debug` を選んだ場合だけ表示します。

項目のチェックを外すと、そのEPCとの同期・操作を止めます。ただしHomeKitサービスで必須のCharacteristicはタイル上に残る場合があります。表示名の変更はChild Bridge再起動後に反映されますが、Appleホーム側で変更済みの名前は保持されることがあります。

新しく検出した機器は安全のため初期状態で「HomeKitに表示」がOFFです。追加したい機器だけをONにして設定を保存し、Child Bridgeを再起動してください。設定変更から再起動までの間は、稼働中の設定との食い違いを防ぐため「機器を再探索」を実行できません。

## 実機なしでの確認

ECHONET Liteエミュレーターを同じLANまたはローカル環境で動かし、探索、Get、SetC、INFを確認します。実機確認時は、機器ごとのプロパティマップに含まれる読み書き可能EPCだけを利用してください。
