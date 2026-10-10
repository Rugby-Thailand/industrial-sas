# Local barcode decoder

`zxing_reader.wasm` is the unmodified reader binary from the exact `zxing-wasm@3.1.5` dependency. SHA-256:

`aecc1876de036c62c8419f67a5e1a16b1698a325bcd190aa84810d516e263931`

Upstream ZXing-C++ commit: `2ecec3f5be0ee803f6e14a5a2c7028c0cfe525b4`.

The application loads this asset from its own origin. Updating the dependency requires copying its `dist/reader/zxing_reader.wasm` here; `barcodeImage.test.ts` checks that the installed and served binaries match.

Attribution: ZXing-C++ and the C++ WASM wrapper use Apache-2.0 (`LICENSE-Apache-2.0.txt`). The JavaScript wrapper uses MIT (`LICENSE-zxing-wasm.txt`). The reader binary excludes the Zint writer; synthetic fixture generation uses the installed writer only in the local verification harness.

Sources: [ZXing WASM](https://github.com/Sec-ant/zxing-wasm), [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp).
