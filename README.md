# Homebridge ECHONET Lite Plus

[GitHub](https://github.com/sylpied/homebridge-echonet-lite-plus) · [Issues](https://github.com/sylpied/homebridge-echonet-lite-plus/issues) · [ECHONET公式MRA](https://echonet.jp/spec_mra_rr3/)

LAN内の ECHONET Lite 機器と直接通信し、HomeKit に公開するHomebridge動的プラットフォームです。MQTTブローカーは不要です。

ECHONET ConsortiumのMachine Readable Appendix Version 1.4.0を同梱し、EPCの名称、アクセス規則、数値型、符号、倍率、状態enumの読書きをMRAから解決します。HomeKitサービスへの割当ては、MRAで変換したプロパティ名を使用します。

MRAはECHONET Consortiumが公開する参考データです。本プラグインのMITライセンスはMRA自体の著作権や利用条件を変更するものではありません。

## 対応方針

ECHONET Liteの機器クラスとプロパティを、意味が一致するHomeKitサービスへ割り当てます。HomeKitに対応する型がない計測値を、照度や湿度など別の値へ偽装することはありません。

| ECHONET Lite機器 | EOJ | HomeKitでの扱い |
| --- | --- | --- |
| 家庭用エアコン | `0130` | Heater/Cooler、運転、モード、室温、設定温度 |
| 換気扇・空気清浄機 | `0133` / `0135` | Fan |
| 電気錠 | `026F` | Lock Mechanism |
| 一般・単機能照明 | `0290` / `0291` | Lightbulb、電源、明るさ |
| 温度・湿度センサー | `0011` / `0012` | 専用センサー |
| 電力量計・分電盤・スマートメーター | `0280` / `0287` / `0288` | Eve互換の電力・電流・積算電力量 |
| 水流量メーター | `0281` | 積算水道使用量、検針データ異常、標準Leak Sensorによる異常通知 |
| ガスメーター | `0282` | 積算ガス使用量 |

Appleのホームアプリには電力・水道・ガス使用量の標準表示がありません。これらは正しい単位のカスタムCharacteristicとして公開され、対応するHomeKitアプリから参照できます。

## 構成

HomebridgeをECHONET Lite機器と同じLANで動かし、設定画面で自動探索を有効にします。複数NIC環境では対象ネットワークを指定してください。

## 設定

- `targetNetwork`: 使用するIPv4ネットワーク。複数NIC環境で指定します。
- `autoDiscovery`: マルチキャストによる機器探索です。
- `knownDeviceIps`: 自動探索へ応答しない機器のIPアドレスです。
- `includeDevices` / `excludeDevices`: IP、EOJ、内部識別子によるフィルターです。
- `deviceSettings`: 検出済み機器ごとのHomeKit公開、表示名、表示・操作項目の選択です。通常はカスタムUIから設定します。
- `meterDisplayMode`: `appleHome`（推奨）はAppleホーム非対応の計測タイルを隠し、`extended`はEveなど対応アプリ向けのカスタム計測値を公開します。
- `logLevel`: 通常は `info` を推奨します。

通常ログでは接続、機器追加、HomeKitからの操作、警告、エラーだけを表示します。ECHONET LiteのINF由来を含む頻繁なpushデータと検出詳細は `debug` を選んだ場合だけ表示します。

項目のチェックを外すと、そのEPCとの同期・操作を止めます。ただしHomeKitサービスで必須のCharacteristicはタイル上に残る場合があります。表示名の変更はChild Bridge再起動後に反映されますが、Appleホーム側で変更済みの名前は保持されることがあります。

## 実機なしでの確認

ECHONET Liteエミュレーターを同じLANまたはローカル環境で動かし、探索、Get、SetC、INFを確認します。実機確認時は、機器ごとのプロパティマップに含まれる読み書き可能EPCだけを利用してください。
