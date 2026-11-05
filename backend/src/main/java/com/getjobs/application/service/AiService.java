package com.getjobs.application.service;

import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.mapper.AiMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * AI 服务（Spring 管理）
 * 从数据库配置获取 BASE_URL、API_KEY、MODEL 并发起 AI 请求。
 *
 * <p>成本治理（v0.2.0 起）：
 * <ul>
 *   <li>{@code AI_MAX_TOKENS} 限制单次输出长度，默认 300 —— 一句 50-80 字的招呼语用不完，
 *       但推理模型不加限制时会输出几千 token 的思考过程，按输出计费，这是账单失控的主因；</li>
 *   <li>{@code AI_DISABLE_THINKING} 尝试让模型关闭思维链；部分兼容层不认这个参数，
 *       碰到一次 400 后自动永久关闭该参数，不会一直重试；</li>
 *   <li>每次调用前检查 {@code AI_RUN_LIMIT} / {@code AI_DAILY_LIMIT} 预算闸门；</li>
 *   <li>成功调用后把 usage 交给 {@link AiUsageService} 累计，面板可查今日与本次运行用量。</li>
 * </ul>
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class AiService {

    /** 默认单次输出上限。 */
    public static final int DEFAULT_MAX_TOKENS = 300;
    /** 默认单次运行调用上限；0 表示不限。 */
    public static final int DEFAULT_RUN_LIMIT = 30;
    /** 默认每日调用上限；0 表示不限。 */
    public static final int DEFAULT_DAILY_LIMIT = 300;

    private final ConfigService configService;
    private final AiMapper aiMapper;
    private final AiUsageService usageService;

    /** 有些兼容层不认 thinking 参数，碰到一次 400 后就永久关闭该参数。 */
    private volatile boolean thinkingSwitchSupported = true;
    /** 同理：不是所有 OpenAI 兼容层都支持 reasoning_effort。 */
    private volatile boolean reasoningEffortSupported = true;

    /**
     * 发送 AI 请求（非流式）并返回回复内容。
     * @param content 用户消息内容
     * @return AI 回复文本
     */
    public String sendRequest(String content) {
        return sendRequest(content, -1);
    }

    /**
     * 同上，但允许覆盖本次请求的 max_tokens。
     *
     * <p>批量生成招呼语时一次要吐 10 条 × 80-120 字，用全局的 300 会把后面的条目截断，
     * 所以按条数把本次预算放大；-1 表示沿用配置值。
     */
    public String sendRequest(String content, int maxTokensOverride) {
        assertBudget();

        // 读取并校验配置
        var cfg = configService.getAiConfigs();
        String baseUrl = cfg.get("BASE_URL");
        String apiKey = cfg.get("API_KEY");
        String model = cfg.get("MODEL");
        // 根据模型类型选择兼容的端点（部分“推理/Reasoning”模型需要使用 Responses API）
        String endpoint = isResponsesModel(model)
                ? buildResponsesEndpoint(baseUrl)
                : buildChatCompletionsEndpoint(baseUrl);

        int timeoutInSeconds = 60;
        int maxTokens = maxTokensOverride > 0
                ? maxTokensOverride
                : getIntSetting("AI_MAX_TOKENS", DEFAULT_MAX_TOKENS);

        // 构建 JSON 请求体
        JSONObject requestData = new JSONObject();
        requestData.put("model", model);
        requestData.put("temperature", 0.5);
        if (endpoint.endsWith("/responses")) {
            // Responses API 采用 input 字段
            requestData.put("input", content);
            if (maxTokens > 0) requestData.put("max_output_tokens", maxTokens);
            // 如需显式控制推理强度，可按需开启：
            // JSONObject reasoning = new JSONObject();
            // reasoning.put("effort", "medium");
            // requestData.put("reasoning", reasoning);
        } else {
            // Chat Completions API 使用 messages
            JSONArray messages = new JSONArray();
            JSONObject message = new JSONObject();
            message.put("role", "user");
            message.put("content", content);
            messages.put(message);
            requestData.put("messages", messages);
            if (maxTokens > 0) requestData.put("max_tokens", maxTokens);
        }
        // 思考模式：off（关闭，最省）/ auto（模型默认）/ high（深度思考，最贵）
        String thinkingMode = getThinkingMode();
        if ("off".equals(thinkingMode) && thinkingSwitchSupported) {
            JSONObject thinking = new JSONObject();
            thinking.put("type", "disabled");
            requestData.put("thinking", thinking);
        } else if ("high".equals(thinkingMode) && reasoningEffortSupported) {
            requestData.put("reasoning_effort", "high");
        }

        try {
            HttpResponse<String> response = post(endpoint, apiKey, requestData, timeoutInSeconds);

            // 兼容层不支持思考参数时，去掉它重试一次，之后不再携带
            if (response.statusCode() == 400) {
                boolean retried = false;
                if (requestData.has("thinking")) {
                    thinkingSwitchSupported = false;
                    requestData.remove("thinking");
                    retried = true;
                }
                if (requestData.has("reasoning_effort")) {
                    reasoningEffortSupported = false;
                    requestData.remove("reasoning_effort");
                    retried = true;
                }
                if (retried) {
                    log.warn("当前模型不支持思考参数，已自动去掉并重试: {}", brief(response.body()));
                    response = post(endpoint, apiKey, requestData, timeoutInSeconds);
                }
            }

            if (response.statusCode() == 200) {
                JSONObject responseObject = new JSONObject(response.body());

                String requestId = responseObject.optString("id");
                long created = responseObject.optLong("created", 0);
                String usedModel = responseObject.optString("model");

                String responseContent;
                if (endpoint.endsWith("/responses")) {
                    // Responses API：优先读取 output_text
                    responseContent = responseObject.optString("output_text", null);
                    if (responseContent == null || responseContent.isEmpty()) {
                        // 兜底：尝试从通用 choices/message 结构读取（部分代理/兼容层会返回该结构）
                        try {
                            JSONObject messageObject = responseObject.getJSONArray("choices")
                                    .getJSONObject(0)
                                    .getJSONObject("message");
                            responseContent = messageObject.getString("content");
                        } catch (Exception ignore) {
                            responseContent = response.body(); // 最后兜底：返回原始文本，避免空值
                        }
                    }
                } else {
                    // Chat Completions API
                    JSONObject messageObject = responseObject.getJSONArray("choices")
                            .getJSONObject(0)
                            .getJSONObject("message");
                    responseContent = messageObject.getString("content");
                }

                JSONObject usageObject = responseObject.optJSONObject("usage");
                int promptTokens = usageObject != null ? usageObject.optInt("prompt_tokens", -1) : -1;
                int completionTokens = usageObject != null ? usageObject.optInt("completion_tokens", -1) : -1;
                int totalTokens = usageObject != null ? usageObject.optInt("total_tokens", -1) : -1;

                LocalDateTime createdTime = created > 0
                        ? Instant.ofEpochSecond(created).atZone(ZoneId.systemDefault()).toLocalDateTime()
                        : LocalDateTime.now();
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

                log.info("AI响应: id={}, time={}, model={}, promptTokens={}, completionTokens={}, totalTokens={}",
                        requestId, createdTime.format(formatter), usedModel, promptTokens, completionTokens, totalTokens);

                recordUsage(usageObject);
                return responseContent;
            } else {
                // 更详细的错误日志，便于定位 400 问题
                log.error("AI请求失败: status={}, endpoint={}, body={}", response.statusCode(), endpoint, brief(response.body()));
                // 针对 Responses-only 模型误用 Chat Completions 的常见错误做一次自动重试
                if (!endpoint.endsWith("/responses") && containsReasoningParamError(response.body())) {
                    String fallbackEndpoint = buildResponsesEndpoint(baseUrl);
                    log.warn("检测到 reasoning 相关参数错误，自动切换到 Responses API 重试: {}", fallbackEndpoint);
                    return sendRequestViaResponses(content, apiKey, model, fallbackEndpoint);
                }
                throw new RuntimeException("AI请求失败，状态码: " + response.statusCode() + ", 详情: " + brief(response.body()));
            }
        } catch (Exception e) {
            log.error("调用AI服务异常", e);
            throw e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e);
        }
    }

    private HttpResponse<String> post(String endpoint, String apiKey, JSONObject body, int timeoutInSeconds)
            throws java.io.IOException, InterruptedException {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(timeoutInSeconds))
                .build();
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                // 某些服务（例如 Azure OpenAI）需要 api-key 头，额外加一层兼容
                .header("api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        return client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    /** 把一次成功调用的 usage 交给统计服务；缺失时按 0 记一次调用。 */
    private void recordUsage(JSONObject usageObject) {
        if (usageObject == null) {
            usageService.record(0, 0, 0);
            return;
        }
        int prompt = usageObject.optInt("prompt_tokens", usageObject.optInt("input_tokens", -1));
        int completion = usageObject.optInt("completion_tokens", usageObject.optInt("output_tokens", -1));
        int total = usageObject.optInt("total_tokens", -1);
        usageService.record(prompt, completion, total);
        log.info("AI用量: 本次 prompt={}, completion={}, total={} | 本次运行累计 {} 次 / {} tokens",
                Math.max(prompt, 0), Math.max(completion, 0), total,
                usageService.runCalls(), usageService.run().get("totalTokens"));
    }

    /** 请求前的预算闸门，超限抛 {@link AiQuotaExceededException}。 */
    private void assertBudget() {
        usageService.assertWithin(
                getIntSetting("AI_RUN_LIMIT", DEFAULT_RUN_LIMIT),
                getIntSetting("AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT));
    }

    /** 投递开始时清零「本次运行」用量。 */
    public void resetRunUsage() {
        usageService.resetRun();
    }

    /** 面板展示用的用量快照。 */
    public Map<String, Object> getUsageSnapshot() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("today", usageService.today());
        body.put("run", usageService.run());

        Map<String, Object> limits = new LinkedHashMap<>();
        limits.put("run", getIntSetting("AI_RUN_LIMIT", DEFAULT_RUN_LIMIT));
        limits.put("daily", getIntSetting("AI_DAILY_LIMIT", DEFAULT_DAILY_LIMIT));
        limits.put("maxTokens", getIntSetting("AI_MAX_TOKENS", DEFAULT_MAX_TOKENS));
        limits.put("disableThinking", getBoolSetting("AI_DISABLE_THINKING", true));
        limits.put("thinkingMode", getThinkingMode());
        limits.put("greetingPool", getBoolSetting("AI_GREETING_POOL", true));
        limits.put("greetingBatch", getIntSetting("AI_GREETING_BATCH", 10));
        body.put("limits", limits);
        body.put("model", configService.getConfigValue("MODEL"));
        body.put("thinkingSwitchSupported", thinkingSwitchSupported);
        return body;
    }

    /**
     * 思考模式：{@code off} / {@code auto} / {@code high}。
     *
     * <p>没配 {@code AI_THINKING_MODE} 时，用旧的 {@code AI_DISABLE_THINKING} 布尔值做兼容迁移：
     * true → off，false → auto。默认 off（省钱）。
     */
    public String getThinkingMode() {
        String raw = configService.getConfigValue("AI_THINKING_MODE");
        if (raw != null && !raw.isBlank()) {
            String mode = raw.trim().toLowerCase(java.util.Locale.ROOT);
            if (mode.equals("off") || mode.equals("auto") || mode.equals("high")) return mode;
        }
        return getBoolSetting("AI_DISABLE_THINKING", true) ? "off" : "auto";
    }

    /** 读整数配置；缺失或非法时回退默认值。 */
    public int getIntSetting(String key, int fallback) {
        String raw = configService.getConfigValue(key);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException error) {
            return fallback;
        }
    }

    /** 读布尔配置，兼容 1/0、true/false、yes/no、on/off。 */
    public boolean getBoolSetting(String key, boolean fallback) {
        String raw = configService.getConfigValue(key);
        if (raw == null || raw.isBlank()) return fallback;
        return switch (raw.trim().toLowerCase()) {
            case "1", "true", "yes", "on" -> true;
            case "0", "false", "no", "off" -> false;
            default -> fallback;
        };
    }

    private String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null) return "";
        String trimmed = baseUrl.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    /**
     * 根据配置构造 chat/completions 端点，避免重复拼接 /v1
     */
    private String buildChatCompletionsEndpoint(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        // 如果 baseUrl 已经包含 /v1（常见配置为 https://api.openai.com/v1），则只拼接 /chat/completions
        if (normalized.endsWith("/v1") || normalized.contains("/v1/")) {
            return normalized + "/chat/completions";
        }
        return normalized + "/v1/chat/completions";
    }

    /**
     * 构造 Responses API 端点
     */
    private String buildResponsesEndpoint(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        if (normalized.endsWith("/v1") || normalized.contains("/v1/")) {
            return normalized + "/responses";
        }
        return normalized + "/v1/responses";
    }

    /**
     * 粗略识别需要使用 Responses API 的模型（o-系列、4.1、reasoner 等）
     */
    private boolean isResponsesModel(String model) {
        if (model == null) return false;
        String m = model.toLowerCase();
        return m.contains("o1") || m.contains("o3") || m.contains("o4")
                || m.contains("4.1") || m.contains("reasoner")
                || m.contains("4o-mini") || m.contains("gpt-4o-mini");
    }

    /**
     * 检查错误响应中是否包含 reasoning 相关参数错误（如 reasoning.summary unsupported_value）
     */
    private boolean containsReasoningParamError(String body) {
        if (body == null) return false;
        String s = body.toLowerCase();
        return (s.contains("reasoning") && s.contains("unsupported_value"))
                || s.contains("reasoning.summary");
    }

    /**
     * 使用 Responses API 发送一次请求（用于自动降级/重试）
     */
    private String sendRequestViaResponses(String content, String apiKey, String model, String endpoint) {
        int timeoutInSeconds = 60;
        int maxTokens = getIntSetting("AI_MAX_TOKENS", DEFAULT_MAX_TOKENS);
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(timeoutInSeconds))
                .build();

        JSONObject requestData = new JSONObject();
        requestData.put("model", model);
        requestData.put("temperature", 0.5);
        requestData.put("input", content);
        if (maxTokens > 0) requestData.put("max_output_tokens", maxTokens);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .header("api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(requestData.toString()))
                .build();

        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                JSONObject resp = new JSONObject(response.body());
                recordUsage(resp.optJSONObject("usage"));
                String outputText = resp.optString("output_text", null);
                if (outputText != null && !outputText.isEmpty()) {
                    return outputText;
                }
                // 兜底解析：部分兼容层可能返回 choices/message 结构
                try {
                    JSONObject messageObject = resp.getJSONArray("choices")
                            .getJSONObject(0)
                            .getJSONObject("message");
                    return messageObject.getString("content");
                } catch (Exception ignore) {
                }
                // 无法解析则直接返回原始体，避免空值中断流程
                return response.body();
            }
            log.error("Responses API 调用失败: status={}, endpoint={}, body={}", response.statusCode(), endpoint, brief(response.body()));
            throw new RuntimeException("AI请求失败，状态码: " + response.statusCode() + ", 详情: " + brief(response.body()));
        } catch (Exception e) {
            log.error("Responses API 调用异常", e);
            throw e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e);
        }
    }

    /** 日志里只保留一小段响应体，避免把整页错误 HTML 刷进日志。 */
    private static String brief(String body) {
        if (body == null) return "";
        return body.length() > 400 ? body.substring(0, 400) + "…" : body;
    }

    // ================= 合并的 AI 配置管理方法 =================

    /**
     * 获取AI配置（获取最新一条，如果不存在则创建默认配置）
     */
    @Transactional(readOnly = true)
    public AiEntity getAiConfig() {
        var list = aiMapper.selectList(null);
        AiEntity aiEntity = (list == null || list.isEmpty()) ? null : list.get(list.size() - 1);
        if (aiEntity == null) {
            aiEntity = createDefaultConfig();
        }
        return aiEntity;
    }

    /**
     * 获取所有AI配置
     */
    @Transactional(readOnly = true)
    public java.util.List<AiEntity> getAllAiConfigs() {
        return aiMapper.selectList(null);
    }

    /**
     * 根据ID获取AI配置
     */
    @Transactional(readOnly = true)
    public AiEntity getAiConfigById(Long id) {
        return aiMapper.selectById(id);
    }

    /**
     * 保存或更新AI配置（introduce/prompt）
     */
    @Transactional
    public AiEntity saveOrUpdateAiConfig(String introduce, String prompt) {
        var list = aiMapper.selectList(null);
        AiEntity aiEntity = (list == null || list.isEmpty()) ? null : list.get(list.size() - 1);

        if (aiEntity == null) {
            aiEntity = new AiEntity();
            aiEntity.setIntroduce(introduce);
            aiEntity.setPrompt(prompt);
            aiEntity.setCreatedAt(java.time.LocalDateTime.now());
            aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
            aiMapper.insert(aiEntity);
            log.info("创建新的AI配置，ID: {}", aiEntity.getId());
        } else {
            aiEntity.setIntroduce(introduce);
            aiEntity.setPrompt(prompt);
            aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
            aiMapper.updateById(aiEntity);
            log.info("更新AI配置，ID: {}", aiEntity.getId());
        }

        return aiEntity;
    }

    /**
     * 删除AI配置
     */
    @Transactional
    public boolean deleteAiConfig(Long id) {
        int result = aiMapper.deleteById(id);
        if (result > 0) {
            log.info("删除AI配置成功，ID: {}", id);
            return true;
        }
        return false;
    }

    /**
     * 创建默认配置
     */
    @Transactional
    protected AiEntity createDefaultConfig() {
        AiEntity aiEntity = new AiEntity();
        aiEntity.setIntroduce("请在此填写您的技能介绍");
        aiEntity.setPrompt("请在此填写AI提示词模板");
        aiEntity.setCreatedAt(java.time.LocalDateTime.now());
        aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
        aiMapper.insert(aiEntity);
        log.info("创建默认AI配置，ID: {}", aiEntity.getId());
        return aiEntity;
    }
}
