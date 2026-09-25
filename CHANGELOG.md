# Changelog

## [0.1.1](https://github.com/xavicrip/elicitacion_requisitos/compare/v0.1.0...v0.1.1) (2026-09-25)


### Correcciones

* **ci:** detect destructive migrations without false positives ([58401c6](https://github.com/xavicrip/elicitacion_requisitos/commit/58401c6fbbbec36664e5c10bfa1ed2339fb895f9))
* **ci:** wait for the web version instead of the commit ([6b9f2ea](https://github.com/xavicrip/elicitacion_requisitos/commit/6b9f2ea0ba362974c81afe1dab103d55dee47fe1))

## 0.1.0 (2026-09-25)


### Funcionalidades

* **analytics:** add health and version endpoints ([e03a48a](https://github.com/xavicrip/elicitacion_requisitos/commit/e03a48a802ec9184422b8eeea939e415dd637b9f))
* **analytics:** add request id middleware and JSON logs ([c0ba2d2](https://github.com/xavicrip/elicitacion_requisitos/commit/c0ba2d2bf85a961597cd2803bd6d859971512b5f))
* **analytics:** validate environment configuration ([fcfae41](https://github.com/xavicrip/elicitacion_requisitos/commit/fcfae41e5c310bba478369927503824f3db5f269))
* **api:** add health, deep health, version and config endpoints ([cbd2502](https://github.com/xavicrip/elicitacion_requisitos/commit/cbd2502e2f5f70533570ec211099021c57734665))
* **api:** add reversible migrations with lock and policy tests ([5c33e73](https://github.com/xavicrip/elicitacion_requisitos/commit/5c33e73699a572b0a0dc84d3ee42237d1bb54334))
* **api:** add security headers and restricted CORS ([b90af96](https://github.com/xavicrip/elicitacion_requisitos/commit/b90af960b8fa621db78e331e503aa8cae296573b))
* **api:** load feature flags from environment ([7fb8b9a](https://github.com/xavicrip/elicitacion_requisitos/commit/7fb8b9ac0afbb7ab788f9ce51446767a20b11034))
* **api:** propagate request id through logs and internal calls ([9f2f698](https://github.com/xavicrip/elicitacion_requisitos/commit/9f2f698cc9f1f870b5b61fe884825a3979e2c3dd))
* **api:** validate environment configuration at startup ([2cc0aa9](https://github.com/xavicrip/elicitacion_requisitos/commit/2cc0aa9a3d17fa9a5f6f4e4021b223a596785089))
* **ops:** add rollback script with ordered migration revert ([537611a](https://github.com/xavicrip/elicitacion_requisitos/commit/537611ab0e4521f4daa622c47e97e4aa83d6106d))
* **shared:** add feature flag registry and resolver ([fdc97e9](https://github.com/xavicrip/elicitacion_requisitos/commit/fdc97e93d221ab275bb35ab45c4872e976d78f40))
* **shared:** add health schema validated against the contract ([c6b26fe](https://github.com/xavicrip/elicitacion_requisitos/commit/c6b26fee1aee1b65eaacda8287144443cf7b5480))
* **web:** add landing page with version and three.js preview ([2e87296](https://github.com/xavicrip/elicitacion_requisitos/commit/2e87296d67ceae377e98fd02f5c504a621921ace))


### Correcciones

* **ci:** fail the deploy step when any Railway deploy fails ([9a97d05](https://github.com/xavicrip/elicitacion_requisitos/commit/9a97d0594b221b26879e43356f222f749362ab32))
* **ci:** grant actions read to release workflow ([ccdca7c](https://github.com/xavicrip/elicitacion_requisitos/commit/ccdca7cd11394e0e8940759e90389c9c9583e3e5))
* **ci:** start releases at 0.1.0 ([43b6697](https://github.com/xavicrip/elicitacion_requisitos/commit/43b669797fd2b46d68bd1a96f1505b1aed82abf0))
* **ci:** wait for the new version before running smoke tests ([4b27040](https://github.com/xavicrip/elicitacion_requisitos/commit/4b27040f17d10d61a203c85ecfab119015d034f4))
* **infra:** drop BuildKit cache mounts unsupported by Railway builder ([71780e5](https://github.com/xavicrip/elicitacion_requisitos/commit/71780e52dc4ea6217a5c7cfd9c6cb6d8cd1f685a))
* **infra:** remove Railway watch patterns so every main commit deploys ([cd37d7c](https://github.com/xavicrip/elicitacion_requisitos/commit/cd37d7c1b19e16cd994dacbe5670ebc7b8e49564))


### Refactorizaciones

* **api:** drop deprecated requestIdLogLabel option ([4ebfd8c](https://github.com/xavicrip/elicitacion_requisitos/commit/4ebfd8c91e67e0cbec39b3e4aad2c45b59aab2d0))


### Build

* **analytics:** add Dockerfile and dual-stack listener ([b3bbd19](https://github.com/xavicrip/elicitacion_requisitos/commit/b3bbd19600544b5ba7697bf7f667634232c66b06))
* **api:** add multi-stage Dockerfile running as non-root ([f259955](https://github.com/xavicrip/elicitacion_requisitos/commit/f259955798f014580a8e94b5f54fa9a56da095c7))
* **infra:** add local Docker Compose stack and Playwright smoke tests ([d5216ab](https://github.com/xavicrip/elicitacion_requisitos/commit/d5216abe017ca13f875d12710e0eaa44bdcfbb27))
* **infra:** add Railway config as code for api, analytics and web ([0111ab3](https://github.com/xavicrip/elicitacion_requisitos/commit/0111ab33e188743b2966e1288608ea15164a0a10))
* **web:** add Caddy image with runtime config and healthcheck ([71ff8d8](https://github.com/xavicrip/elicitacion_requisitos/commit/71ff8d802521fc68b8ab23bd9ce8801ff807d59b))


### CI/CD

* add migration revert and backup restore actions to deploy ([7d98559](https://github.com/xavicrip/elicitacion_requisitos/commit/7d985592e755c02fbe265684c67e08b369cb4554))
* add pull request and main validation workflow ([abc28a4](https://github.com/xavicrip/elicitacion_requisitos/commit/abc28a4fed2c836a8a1e70d1b35319c902c35cc9))
* add Railway deployment workflow with smoke tests and version check ([400cb46](https://github.com/xavicrip/elicitacion_requisitos/commit/400cb4603cf985f0e7e8e81be35798e364559661))
* add release-please workflow that deploys tagged releases ([7915c69](https://github.com/xavicrip/elicitacion_requisitos/commit/7915c6974d669a21ba63ef10bc2b475d05969805))
* configure gitleaks secret detection ([dde2370](https://github.com/xavicrip/elicitacion_requisitos/commit/dde237000d4324aab16f850aaa01a04f7f265f2c))
* run validation on feature branch pushes ([00cdcf0](https://github.com/xavicrip/elicitacion_requisitos/commit/00cdcf0bd51206093d8370e87948df6870ed9e1d))
* validate feature branches only through their pull request ([2b3523a](https://github.com/xavicrip/elicitacion_requisitos/commit/2b3523a0eb340bc1a645acad74d5224bf8269a54))
