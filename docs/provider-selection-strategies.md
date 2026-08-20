# 多翻译服务选择策略调研

调研时间：2026-08-20

## 结论先行

和本项目最接近的翻译聚合器，主流做法其实并不复杂：

- 让用户指定默认服务，并按配置顺序失败兜底；
- 或者同时调用多个服务，把多个结果一起展示；
- “持续自动选择最低延迟”更常见于网关/负载均衡器，而不是桌面翻译工具。

因此，本项目没有引入 EWMA、复杂打分、指数冷却。自动模式采用以下规则：

> 保留启动测速；测速结果有效 10 分钟。用户再次翻译时如果结果已过期，就在后台复用同一套测速并刷新顺序，本次请求仍用旧顺序；请求失败继续按当前顺序兜底。

固定模式保持现状，严格按用户顺序兜底，不参与测速排序。

这比“只在启动时测一次”更能适应网络变化，同时只需要“测速时间戳 + 过期后后台刷新”，没有动态评分、失败次数、冷却状态等额外模型。

## 翻译类产品怎么做

| 产品/项目 | 官方公开的策略 | 对本项目的启示 |
| --- | --- | --- |
| [LinguaLens](https://github.com/q-jade/lingualens#features) | 配置一个默认服务和可选的 fallback order；默认服务失败后按配置顺序尝试下一家。 | 这是当前“固定模式”的直接同类方案：简单、可预测。 |
| [translate-tools/core](https://github.com/translate-tools/core#fallback-translator) | fallback translator 始终先用列表第一项；抛错或 reject 后再尝试下一个兼容服务。 | 进一步说明“有序兜底”是翻译聚合库里的常见基础能力，并不要求动态打分。 |
| [Pot](https://github.com/pot-app/pot-desktop#features) | 官方特性写明“多接口并行翻译”。 | 另一条产品路线是并发展示所有结果，而不是挑选一家最快的结果。它适合比较译文，不适合本插件当前“一次翻译返回一个结果”的目标。 |
| [沉浸式翻译](https://immersivetranslate.com/docs/faq/#7-exclamation-mark-on-the-page) | 官方 FAQ 对 429 或翻译失败的建议是暂时切换到另一翻译服务，属于“用户选择 + 手动切换”。 | 最省实现成本，但自动体验弱于本项目已有的有序兜底。 |
| [Translate Shell](https://github.com/soimort/translate-shell#translator-options) | 默认使用 Google，也允许通过 `--engine` 指定单个引擎。 | 说明很多轻量翻译工具甚至只做默认引擎/显式选择，不追求实时最优路由。 |

公开资料只能证明这些项目文档中声明的行为，不能据此断言它们内部完全没有未公开的测速或健康策略。

## 更成熟的上游选择系统怎么做

### 1. 历史真实延迟：LiteLLM

[LiteLLM Router](https://docs.litellm.ai/docs/routing#advanced---routing-strategies-%EF%B8%8F) 提供 latency-based routing：缓存各 deployment 的响应时间，并在请求完成后更新缓存，随后选择响应时间最低者；它还允许设置统计时间窗口和“最低延迟缓冲区”。[LiteLLM 的 fallback 文档](https://docs.litellm.ai/docs/proxy/reliability) 另外把跨模型/服务失败切换作为独立机制。

这是“启动测速 + 实际请求持续学习”的成熟同类，但复制到只有三个服务的 VS Code 插件会带来统计窗口、冷启动、公平采样、状态过期等问题。值得作为后续版本，而不是当前最简方案。

### 2. 定期主动检查 + 请求失败被动摘除：Envoy / HAProxy

[Envoy](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/health_checking) 同时支持主动健康检查和基于 outlier detection 的被动健康检查；官方还建议主动检查间隔可以设长一些，以避免大量探测流量。[Envoy 的 outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier.html) 会根据连续失败、阶段成功率或阶段延迟等表现，把异常上游暂时移出健康集合。

[HAProxy](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/reliability/health-checks/) 也把定期主动探测、连续失败阈值、连续成功后恢复作为标准健康检查模型。

对本项目最有价值的是思想拆分，而不是照搬全部参数：

- 主动检查负责刷新“谁更快/是否可用”；
- 真实翻译失败由现有 fallback 立即保证本次请求成功；
- 只有确实出现频繁抖动时，再增加失败冷却。

### 3. 固定后备和失败窗口：NGINX

[NGINX upstream](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) 默认会在与某台上游通信出错后尝试下一台可用上游，并提供 `max_fails` / `fail_timeout` 暂时判定不可用，以及 `backup` 后备服务器。

这与本项目固定模式的心智模型接近：配置顺序/主备关系优先，失败窗口只负责避免反复撞到坏节点。它不等同于“实时选择最低延迟”。

### 4. 延迟竞速：Happy Eyeballs

[RFC 8305](https://www.rfc-editor.org/rfc/rfc8305.html#section-5) 的 Happy Eyeballs 会按顺序错峰启动多个连接，某个连接建立成功后取消其他尝试；它也允许用历史 RTT 影响后续尝试的延迟。

这个思路能得到“当次实际最快”，但不建议直接用于翻译请求：连接竞速只竞争建连，重复提交翻译则可能让多家服务都处理用户文本、产生多份流量或费用，而且取消客户端请求不代表服务端一定停止处理。除非以后有明确的隐私、配额和取消语义，否则不要做“同时把用户原文发给多家，谁先返回用谁”。

## 方案比较

| 方案 | 新鲜度 | 实现复杂度 | 额外请求 | 适合当前项目 |
| --- | ---: | ---: | ---: | --- |
| 仅启动测速 | 低 | 最低 | 每次启动 3 个 | 已有，但长时间运行后可能过时 |
| 启动测速 + 过期后台重测 | 中高 | 低 | 每 10 分钟最多 3 个小探测 | **推荐** |
| 真实请求延迟统计/移动平均 | 高 | 中 | 无额外探测，但需要探索非首选服务 | 后续优化 |
| 失败冷却/指数退避 | 提升可用性，不直接提升延迟判断 | 中 | 无 | 频繁失败后再加 |
| 并发竞速真实翻译 | 当次最高 | 中高 | 每次放大至多 3 倍 | 不推荐 |
| 固定顺序兜底 | 不自动适应 | 低 | 无 | 继续作为用户可控模式 |

## 落地边界

自动模式的实现边界：

1. 启动时照旧并行测试全部启用服务。
2. 保存本次排序和完成时间。
3. 翻译开始时，如果排序未过期，直接使用。
4. 如果超过 10 分钟，在后台启动一次去重后的重测；本次翻译不等待它，仍按旧顺序执行。
5. 重测完成后更新后续请求的顺序；重测失败的服务排在可用服务之后。
6. 固定模式完全绕过上述逻辑，继续按用户配置顺序兜底。

暂不增加以下能力：持久化历史数据、EWMA、随机探索、失败次数、指数冷却、并发发送真实用户文本。等实际观察到“某个坏服务在两次测速之间持续拖慢请求”后，再单独加入一个短期失败降级即可。

## 当前项目对应位置

- `src/extension.ts`：激活和配置变化时触发测速。
- `src/configuration.ts`：并行测速、按可用性与耗时排序、等待测速结果。
- `src/translator.ts`：按传入顺序逐个调用，失败后顺序兜底。

这意味着推荐方案只需扩展自动排序的刷新时机，不需要改动翻译 provider 接口，也不需要改变固定模式的调用语义。
