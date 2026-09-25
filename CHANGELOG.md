# Changelog

## 1.0.0 (2026-09-25)


### Funcionalidades

* **analytics:** add health and version endpoints ([2412178](https://github.com/xavicrip/elicitacion_requisitos/commit/2412178901b9a8a00ca7008916586582242f31d8))
* **analytics:** add request id middleware and JSON logs ([8686fad](https://github.com/xavicrip/elicitacion_requisitos/commit/8686fadc3b76bed0faf4482c21b42f56eeb5e89a))
* **analytics:** validate environment configuration ([a4a5c2f](https://github.com/xavicrip/elicitacion_requisitos/commit/a4a5c2ff2300777854f04d7e71a6e0bad740e888))
* **api:** add health, deep health, version and config endpoints ([de5be97](https://github.com/xavicrip/elicitacion_requisitos/commit/de5be971c312be898f33b086057e979c1219ff70))
* **api:** add reversible migrations with lock and policy tests ([86d6b55](https://github.com/xavicrip/elicitacion_requisitos/commit/86d6b55c83a7cd8646fe5f2d0b20db0f329a762b))
* **api:** add security headers and restricted CORS ([ed14450](https://github.com/xavicrip/elicitacion_requisitos/commit/ed144502bd9cfb037cd72004005313dee39a1f81))
* **api:** load feature flags from environment ([c38c96f](https://github.com/xavicrip/elicitacion_requisitos/commit/c38c96fbf8a17431818b322eb26626408b585772))
* **api:** propagate request id through logs and internal calls ([2123ee6](https://github.com/xavicrip/elicitacion_requisitos/commit/2123ee6363b1e606e6ed59c0a06e454f90583d28))
* **api:** validate environment configuration at startup ([c74949f](https://github.com/xavicrip/elicitacion_requisitos/commit/c74949f792bcf9b5ac072366d2fa3a7a08c97511))
* **ops:** add rollback script with ordered migration revert ([0d807c8](https://github.com/xavicrip/elicitacion_requisitos/commit/0d807c80f1304f42daff0f362b2797d8614a9660))
* **shared:** add feature flag registry and resolver ([07af3d5](https://github.com/xavicrip/elicitacion_requisitos/commit/07af3d5aa1c14474626a7ad3810c1efb4e3a7c31))
* **shared:** add health schema validated against the contract ([dd2a0ac](https://github.com/xavicrip/elicitacion_requisitos/commit/dd2a0ac819a1dffd85fe0e766b16514b9db92a06))
* **web:** add landing page with version and three.js preview ([20acbc2](https://github.com/xavicrip/elicitacion_requisitos/commit/20acbc2ec02962467e2ed834b8b894ac1dcb04c7))


### Refactorizaciones

* **api:** drop deprecated requestIdLogLabel option ([d6cd916](https://github.com/xavicrip/elicitacion_requisitos/commit/d6cd91682e8bee438f4f0f0148ab020f6df4ca8a))


### Build

* **analytics:** add Dockerfile and dual-stack listener ([e8dce8a](https://github.com/xavicrip/elicitacion_requisitos/commit/e8dce8a0d2dab18a95a5806a98dd69d5602fbdd9))
* **api:** add multi-stage Dockerfile running as non-root ([d3d73f8](https://github.com/xavicrip/elicitacion_requisitos/commit/d3d73f85d2a60e7d8a3e64e8096ffda641c4de35))
* **infra:** add local Docker Compose stack and Playwright smoke tests ([34b7dea](https://github.com/xavicrip/elicitacion_requisitos/commit/34b7deacb0624cb6b6e188af61fc66fb8dfda25a))
* **infra:** add Railway config as code for api, analytics and web ([85fffe1](https://github.com/xavicrip/elicitacion_requisitos/commit/85fffe1b5800190fd38d7714836f8aad7b91a629))
* **web:** add Caddy image with runtime config and healthcheck ([0c74690](https://github.com/xavicrip/elicitacion_requisitos/commit/0c746909382ecbbf9ba072f7c76ee374c0d7d72b))


### CI/CD

* add migration revert and backup restore actions to deploy ([6acdcba](https://github.com/xavicrip/elicitacion_requisitos/commit/6acdcba980ca34e884f366905ecb4909e6c86e7d))
* add pull request and main validation workflow ([76dd7f9](https://github.com/xavicrip/elicitacion_requisitos/commit/76dd7f93b985efd42d4d54d5d8dde0ebf695282a))
* add Railway deployment workflow with smoke tests and version check ([d51e1d7](https://github.com/xavicrip/elicitacion_requisitos/commit/d51e1d7362ad13a36066730edddc4ba30d183356))
* add release-please workflow that deploys tagged releases ([25aae5f](https://github.com/xavicrip/elicitacion_requisitos/commit/25aae5f7b5b27466b2d51a59fc39633d99b9b637))
* configure gitleaks secret detection ([ec78b8b](https://github.com/xavicrip/elicitacion_requisitos/commit/ec78b8b8c5f10d3a8557b8fc2d613b3e1a5b8ca8))
* run validation on feature branch pushes ([b17aee6](https://github.com/xavicrip/elicitacion_requisitos/commit/b17aee69d583cee6654f3597ba169a08b123131d))
* validate feature branches only through their pull request ([24da35e](https://github.com/xavicrip/elicitacion_requisitos/commit/24da35e0a16dd970a682910b1efdcbddb1c29a0f))
