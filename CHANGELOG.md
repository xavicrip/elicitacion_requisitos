# Changelog

## [0.5.0](https://github.com/xavicrip/elicitacion_requisitos/compare/v0.4.0...v0.5.0) (2026-10-01)


### Funcionalidades

* **api:** add requirement coverage per activity for the canvas ([ae6308a](https://github.com/xavicrip/elicitacion_requisitos/commit/ae6308adc218c1307e0e03048b0aca0ab7107c56))
* **api:** add the detail, vote, comment and history models ([b648daf](https://github.com/xavicrip/elicitacion_requisitos/commit/b648dafdf0e9feb0fdf11f3da2ccfeab2c202206))
* **api:** add the in-process domain events for requirement details ([f955f01](https://github.com/xavicrip/elicitacion_requisitos/commit/f955f019854276371d9fe292abbe1a631c5a0aef))
* **api:** add the requirement details indexes migration ([d1a8d80](https://github.com/xavicrip/elicitacion_requisitos/commit/d1a8d80e9e25975f65916de572d86c0ee6e819e0))
* **api:** cascade requirement details and keep them as orphans ([9545ea9](https://github.com/xavicrip/elicitacion_requisitos/commit/9545ea906b98f7c1670fc010d5b2c3e0305ed330))
* **api:** edit and delete requirement details with history ([31c27b3](https://github.com/xavicrip/elicitacion_requisitos/commit/31c27b3d9ede629f655bd53aeac05be656bf0311))
* **api:** moderate requirement details and reassign orphans ([dc79d34](https://github.com/xavicrip/elicitacion_requisitos/commit/dc79d34bc07bf931d152ad0eba8e4d5e0599dfd7))
* **api:** register and list requirement details per activity ([7c5bf97](https://github.com/xavicrip/elicitacion_requisitos/commit/7c5bf97f856eaabb9eece5dbbb06c69b73801d2f))
* **api:** share If-Match parsing and add a per-user write rate limit ([7592628](https://github.com/xavicrip/elicitacion_requisitos/commit/75926289edcf849ead81471b2b6611a0c736e9f5))
* **api:** vote and comment on requirement details ([f2d9992](https://github.com/xavicrip/elicitacion_requisitos/commit/f2d99927286b4c875c67b275dd8db20acbdb08ff))
* **shared:** add the details feature flag ([26c60c0](https://github.com/xavicrip/elicitacion_requisitos/commit/26c60c009b7d85619aa2f404fea9a1dda38b74b9))
* **shared:** add the requirement detail schemas and domain events ([ce157b8](https://github.com/xavicrip/elicitacion_requisitos/commit/ce157b8df35e2e02461a3015fa22ebf71a38ac8f))
* **shared:** turn the details flag on by default ([2f260cd](https://github.com/xavicrip/elicitacion_requisitos/commit/2f260cd759b5c75ac705870c3ef293e913513117))
* **web:** edit and delete requirement details with history and conflicts ([085c93c](https://github.com/xavicrip/elicitacion_requisitos/commit/085c93c9e8d96bf44418b79058f3a0437c19c281))
* **web:** moderate requirement details and reassign orphans ([524d46a](https://github.com/xavicrip/elicitacion_requisitos/commit/524d46aadd056c5012e303c9b5092059a6d17d16))
* **web:** show and register requirement details beside the diagram ([cf5fd48](https://github.com/xavicrip/elicitacion_requisitos/commit/cf5fd48cd3f81fa6eb49761ae0f19b82de72bf22))
* **web:** show requirement coverage on the diagram ([9ed95ba](https://github.com/xavicrip/elicitacion_requisitos/commit/9ed95ba547814cdf56c45aa5019419cdcd019c68))
* **web:** vote and comment on requirement details ([90945e3](https://github.com/xavicrip/elicitacion_requisitos/commit/90945e3e7c72325c0cd4d5ac03e731632f4b4688))


### Correcciones

* **web:** keep the vote button disabled in a closed project ([795c1c7](https://github.com/xavicrip/elicitacion_requisitos/commit/795c1c706492f510dfffdff41b7647d87f3c38bc))


### Rendimiento

* **api:** measure the details panel and the coverage endpoint ([83bb878](https://github.com/xavicrip/elicitacion_requisitos/commit/83bb878dedb82ce3c0ec071a3d0a24787e5f5a05))
* **web:** measure the canvas with the 004 indicators ([d9be2c0](https://github.com/xavicrip/elicitacion_requisitos/commit/d9be2c05259c93c583bc954823a858206fdd4f65))

## [0.4.0](https://github.com/xavicrip/elicitacion_requisitos/compare/v0.3.0...v0.4.0) (2026-10-01)


### Funcionalidades

* **api:** add resource-scoped and multi-status authorization guards ([50f8364](https://github.com/xavicrip/elicitacion_requisitos/commit/50f83642a423b4f5aea7df14a26685a5422d640d))
* **api:** add the activity dependents registry ([5268a2c](https://github.com/xavicrip/elicitacion_requisitos/commit/5268a2c2b83e2872093d648562288bd21ef89dc6))
* **api:** add the diagram image pipeline ([d05364f](https://github.com/xavicrip/elicitacion_requisitos/commit/d05364f7eea2ab524dbded6228ecfcb9ddb2c4b4))
* **api:** add the diagram, version and activity models ([4020999](https://github.com/xavicrip/elicitacion_requisitos/commit/402099983b265086794c1e0d3a543a5154ec537b))
* **api:** add the diagrams indexes migration ([e128130](https://github.com/xavicrip/elicitacion_requisitos/commit/e1281305c51b95bda55e9c3c2b8f79f3cd720896))
* **api:** add the S3 storage environment variables ([2e62556](https://github.com/xavicrip/elicitacion_requisitos/commit/2e6255667c37490fae41ee473b2e4510eec7305d))
* **api:** add the S3 storage plugin and its deep health check ([d7ee043](https://github.com/xavicrip/elicitacion_requisitos/commit/d7ee0432b43e75bc4686b2698c6dc1886e165c6f))
* **api:** create, edit and delete diagram activities ([b39310e](https://github.com/xavicrip/elicitacion_requisitos/commit/b39310e8ed1beb314d527e1b1a5e55b61aa180b7))
* **api:** delete a project's diagrams in the deletion cascade ([f67c16f](https://github.com/xavicrip/elicitacion_requisitos/commit/f67c16feaae024b4fab393db6ad93c1e08256e17))
* **api:** publish diagram versions and carry activities forward ([bc5c8f7](https://github.com/xavicrip/elicitacion_requisitos/commit/bc5c8f784656b6218d4d7305b4d4ce75dda17af7))
* **api:** upload diagrams and serve their images ([abb85e9](https://github.com/xavicrip/elicitacion_requisitos/commit/abb85e97f8d7313a99fb6453ff840faac0455abc))
* **shared:** add diagram, version and activity schemas ([43727c4](https://github.com/xavicrip/elicitacion_requisitos/commit/43727c481ce3390054ea4a2bc8744270bac78ca6))
* **shared:** add the diagrams feature flag ([7de20be](https://github.com/xavicrip/elicitacion_requisitos/commit/7de20bee47f64f8712434e95f701426c2a941b70))
* **shared:** turn the diagrams flag on by default ([0da4ba7](https://github.com/xavicrip/elicitacion_requisitos/commit/0da4ba703e3397ce01dab0c604b8c4b06b45eea0))
* **web:** add the workspace camera math ([a49237f](https://github.com/xavicrip/elicitacion_requisitos/commit/a49237f73025ce5372d6fb5af863ef9de803bf1a))
* **web:** add the workspace store and the runtime E2E hook ([fc800cb](https://github.com/xavicrip/elicitacion_requisitos/commit/fc800cb479d5d320cca2b73279a79dea518513e8))
* **web:** add the zone editor geometry ([cd3a9ef](https://github.com/xavicrip/elicitacion_requisitos/commit/cd3a9ef1276e9829cc372284b41803ab0972f55a))
* **web:** autosave activity edits and add the activity form ([00d314b](https://github.com/xavicrip/elicitacion_requisitos/commit/00d314b0ab0fcb6dea349805cf956828372672c3))
* **web:** edit activity zones on the canvas ([8f1c4f9](https://github.com/xavicrip/elicitacion_requisitos/commit/8f1c4f9608af633d9b4b12cfb90b96312e562275))
* **web:** list a project's diagrams and upload new ones ([8953da6](https://github.com/xavicrip/elicitacion_requisitos/commit/8953da600f6c22d428e1cc55f42c071fc5199aab))
* **web:** navigate the workspace with hotspots, minimap and keyboard ([434a4b3](https://github.com/xavicrip/elicitacion_requisitos/commit/434a4b3fe7394200468907f5173622e2db6f0536))
* **web:** open a diagram in a minimal three.js workspace ([a159b5f](https://github.com/xavicrip/elicitacion_requisitos/commit/a159b5f076dd35d06c3bdc8d6aefe701ed1c9f4e))
* **web:** publish diagrams and upload new versions ([1b1c5fd](https://github.com/xavicrip/elicitacion_requisitos/commit/1b1c5fd48eccad10052219dd85fe89721ed0e01e))


### Correcciones

* **web:** show pending autosaves and send them when the page unloads ([7c5514d](https://github.com/xavicrip/elicitacion_requisitos/commit/7c5514ddf9def6432702f7262e43c87a68dfd9c8))


### Rendimiento

* **web:** create the WebGL canvas before the image arrives ([a3c8fd8](https://github.com/xavicrip/elicitacion_requisitos/commit/a3c8fd81f82489f46e9aa4ca386e8b7ed1676f75))
* **web:** load the home page canvas preview lazily ([19cb1a2](https://github.com/xavicrip/elicitacion_requisitos/commit/19cb1a2d62b9292aa2f34f1dba712a6913008a06))
* **web:** measure the workspace and keep panning at 60 FPS ([c72367b](https://github.com/xavicrip/elicitacion_requisitos/commit/c72367bb756e57fd3038660d1eeccc1809a6f915))
* **web:** overlap the workspace's first requests ([027b923](https://github.com/xavicrip/elicitacion_requisitos/commit/027b9238785e08acb767e3f17d86e22a5ad0c3b2))

## [0.3.0](https://github.com/xavicrip/elicitacion_requisitos/compare/v0.2.0...v0.3.0) (2026-09-30)


### Funcionalidades

* **api:** add project create, list, edit and status endpoints ([c4da218](https://github.com/xavicrip/elicitacion_requisitos/commit/c4da218612eaa27f4221e9fac9f108ef934d1339))
* **api:** add project members and invitation links ([0d7c759](https://github.com/xavicrip/elicitacion_requisitos/commit/0d7c759d956ef725bed6912b65f7566a9c654862))
* **api:** add project role and status guards ([75530d0](https://github.com/xavicrip/elicitacion_requisitos/commit/75530d090238a8731dd8622e21e83fbec148f84a))
* **api:** add refresh token and session helpers ([03acc58](https://github.com/xavicrip/elicitacion_requisitos/commit/03acc5828068c5193adf7c40bf8d3716d7be1ee9))
* **api:** add register, login, refresh, logout and me endpoints ([041eec0](https://github.com/xavicrip/elicitacion_requisitos/commit/041eec0e3195c072ef5e873a9c1f2849c6e3442d))
* **api:** add session environment variables ([320c3b9](https://github.com/xavicrip/elicitacion_requisitos/commit/320c3b9375dd377851db9e96dd6776c64c8388a0))
* **api:** add the audit log service ([6ba19d7](https://github.com/xavicrip/elicitacion_requisitos/commit/6ba19d7611dc11ea7036862b3edcb9fcaff9322d))
* **api:** add the auth and projects indexes migration ([f75467a](https://github.com/xavicrip/elicitacion_requisitos/commit/f75467a054c709d355951ca986ddedb912926766))
* **api:** add the JWT authentication plugin ([9c265b7](https://github.com/xavicrip/elicitacion_requisitos/commit/9c265b7f88be9f998a20c3d50bd0c14349e541da))
* **api:** add the Redis-backed rate limit for auth routes ([0067b1e](https://github.com/xavicrip/elicitacion_requisitos/commit/0067b1eff8ed5fc42caa9a1e9754bfe58a35dcf1))
* **api:** add users, projects, invitations, refresh token and audit models ([861b2b4](https://github.com/xavicrip/elicitacion_requisitos/commit/861b2b4480b3a9ac3001d1a575bb2fda7ac8a8c3))
* **api:** delete projects asynchronously with a BullMQ cascade job ([5aea66a](https://github.com/xavicrip/elicitacion_requisitos/commit/5aea66ae6a4c32acbaafd062d155254e6b5ebb16))
* **api:** hash passwords with argon2id and check the password policy ([d1afe25](https://github.com/xavicrip/elicitacion_requisitos/commit/d1afe25f37d8b69e3190212375c6aa8115d41f47))
* **api:** validate with zod and answer errors in the contract format ([3e8ac08](https://github.com/xavicrip/elicitacion_requisitos/commit/3e8ac080b0dd5b4f104fa340f079c57bd1b5a2bb))
* **api:** warn when Redis does not use the noeviction policy ([5bab0e6](https://github.com/xavicrip/elicitacion_requisitos/commit/5bab0e63041b31d0f2e0fd87bf7732e625717862))
* **shared:** add auth and project schemas ([8e0ebb7](https://github.com/xavicrip/elicitacion_requisitos/commit/8e0ebb7129017117d39ae8631f52e687dc49bf38))
* **shared:** hide the 002 feature behind the accounts flag ([bdcf885](https://github.com/xavicrip/elicitacion_requisitos/commit/bdcf8853551ab2b115c7ae8c6916b7275a3231e4))
* **shared:** turn the accounts flag on by default ([39e69fc](https://github.com/xavicrip/elicitacion_requisitos/commit/39e69fc47c434543de57daf4ce6495a722961917))
* **web:** add sign-up, login, logout and the empty "Mis proyectos" page ([ce16bce](https://github.com/xavicrip/elicitacion_requisitos/commit/ce16bce902cab418536b5cda8aa94fbd988329cd))
* **web:** add the API client and in-memory session store ([3c11e50](https://github.com/xavicrip/elicitacion_requisitos/commit/3c11e50bd39a90b407f7590aebda387cfd326fca))
* **web:** add the members panel and the invitation page ([1efe023](https://github.com/xavicrip/elicitacion_requisitos/commit/1efe02361b0d155ba0b25d2aec4a3e321451b34f))
* **web:** add the project not found view and test role-based actions ([0e5e7b9](https://github.com/xavicrip/elicitacion_requisitos/commit/0e5e7b93daea9202e8ee6fbe167ea315591e1106))
* **web:** add the router, query client and layout ([bae2290](https://github.com/xavicrip/elicitacion_requisitos/commit/bae229017b3402cb2ca77bd072548c4c3d37411a))
* **web:** list, create, edit, change status and delete projects ([7cfc259](https://github.com/xavicrip/elicitacion_requisitos/commit/7cfc259e1a46e483aa74453986346cb1da2a087d))
* **web:** proxy /api to the api service through the private network ([fcd1d8b](https://github.com/xavicrip/elicitacion_requisitos/commit/fcd1d8b4c6390efec847de439861a3f6159bd46b))


### Correcciones

* **api:** rate limit by the client IP instead of the proxy's ([a14b9e9](https://github.com/xavicrip/elicitacion_requisitos/commit/a14b9e96570118791574c9c7ae10b07a153ab546))


### Rendimiento

* **api:** record local login and project list latency ([8b55543](https://github.com/xavicrip/elicitacion_requisitos/commit/8b555438e2b191ac868c6f0159c4906d8cb3c7e3))


### CI/CD

* pin gitleaks to the version that understands our allowlist ([69574bd](https://github.com/xavicrip/elicitacion_requisitos/commit/69574bd5beeb02797ad87fee0a6c1ffc4259cf75))
* split E2E into read-only smoke and data-creating flows ([29bfd98](https://github.com/xavicrip/elicitacion_requisitos/commit/29bfd988971fed7a16848339267620198e65dfcd))

## [0.2.0](https://github.com/xavicrip/elicitacion_requisitos/compare/v0.1.0...v0.2.0) (2026-09-30)


### Funcionalidades

* **api:** run deploy migrations with backups and MIGRATION_ACTION ([c72c54b](https://github.com/xavicrip/elicitacion_requisitos/commit/c72c54b8038ffa7ceb899766daee6d1755b1172d))
* **ci:** allow migrate-down after a Railway panel rollback ([c6333bf](https://github.com/xavicrip/elicitacion_requisitos/commit/c6333bfd0f7bbda1ec243162eff64956e1eaaa28))


### Correcciones

* **ci:** detect destructive migrations without false positives ([58401c6](https://github.com/xavicrip/elicitacion_requisitos/commit/58401c6fbbbec36664e5c10bfa1ed2339fb895f9))
* **ci:** expand short SHAs in rollback.sh ([81e1a91](https://github.com/xavicrip/elicitacion_requisitos/commit/81e1a91d90b8b29a130886f2a41c63c445363b2a))
* **ci:** follow Railway deployment status instead of the build log stream ([4c44e17](https://github.com/xavicrip/elicitacion_requisitos/commit/4c44e175ed47e54f8ad9789ec19d2ecad003b16b))
* **ci:** roll back migrations and restore backups by redeploying ([88539b5](https://github.com/xavicrip/elicitacion_requisitos/commit/88539b55e1305ad123ba56154e4361b3f93baa2c))
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
