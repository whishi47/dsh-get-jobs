package com.getjobs.application.plugin;

import com.getjobs.application.service.AiService;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 简历评估：给一份简历打分，并给出可执行的修改建议。
 *
 * <p>和 {@link ResumeDraftService} 的区别：草稿服务是"把简历变成投递配置"，
 * 评估服务是"告诉你这份简历哪里不行"。两者共用 {@link AiService}，因此同样受
 * 预算闸门和用量统计约束。
 *
 * <p>返回结构化 JSON，前端负责渲染和导出 HTML 报告 —— 后端不拼 HTML，
 * 避免以后改版式还得重新打包 jar。
 */
@Service
public class ResumeEvaluateService {

    private static final Logger log = LoggerFactory.getLogger(ResumeEvaluateService.class);

    /** 送进模型的正文上限，和草稿服务保持一致。 */
    private static final int MAX_PROMPT_CHARS = 8_000;

    private final AiService aiService;

    public ResumeEvaluateService(AiService aiService) {
        this.aiService = aiService;
    }

    /**
     * 评估简历。失败时抛 {@link IllegalStateException}，由控制器转成可读的错误响应 ——
     * 这里不能像草稿那样静默降级，因为"0 分"会被用户当成真实评价。
     */
    public Map<String, Object> evaluate(String resumeText) {
        String trimmed = resumeText.length() > MAX_PROMPT_CHARS
                ? resumeText.substring(0, MAX_PROMPT_CHARS)
                : resumeText;

        String reply;
        try {
            reply = aiService.sendRequest(buildPrompt(trimmed));
        } catch (RuntimeException error) {
            log.warn("简历评估调用模型失败: {}", safeMessage(error));
            throw new IllegalStateException("调用大模型失败：" + safeMessage(error), error);
        }

        Map<String, Object> parsed = parse(reply);
        if (parsed == null) {
            throw new IllegalStateException("模型没有返回可解析的评估结果，请重试一次；如果反复失败，换一个指令遵循更好的模型。");
        }
        parsed.put("truncated", trimmed.length() < resumeText.length());
        return parsed;
    }

    private static String buildPrompt(String resumeText) {
        return """
                你是资深招聘顾问。请评估下面这份简历，并严格按指定 JSON 输出。

                评分维度（每项 0-100）：
                - 内容完整性：基本信息、教育、工作/项目经历、技能是否齐全；
                - 岗位匹配度：技术栈与目标岗位（Java 后端/全栈）的匹配程度；
                - 成果量化：是否有可验证的数据、指标、规模；
                - 表达清晰度：结构、逻辑、冗余程度；
                - 竞争力：同岗位候选人中的相对优势。

                只输出一个 JSON 对象，不要解释、不要 markdown 代码块。字段固定为：
                {
                  "score": 78,
                  "level": "良好",
                  "summary": "一句话总评，60 字以内",
                  "dimensions": [
                    {"name": "内容完整性", "score": 80, "comment": "30 字以内点评"}
                  ],
                  "strengths": ["3-5 条，每条 40 字以内"],
                  "issues": ["3-5 条，每条 40 字以内"],
                  "suggestions": ["3-5 条，每条 40 字以内"],
                  "keywords": {"hit": ["简历里已出现的关键词"], "missing": ["目标岗位常见但简历缺失的关键词"]}
                }

                要求：
                1. score 是 0-100 的总分，不要和分项平均分自相矛盾；level 用「优秀/良好/及格/待改进」之一。
                2. dimensions 必须覆盖上面五个维度，name 用中文原名。
                3. 只根据简历内容判断，不要编造学历、公司、时间或成果。
                4. 建议要具体可执行，不要写"建议优化简历"这类空话。

                简历文本开始
                ---
                %s
                ---
                简历文本结束
                """.formatted(resumeText);
    }

    private Map<String, Object> parse(String reply) {
        if (reply == null || reply.isBlank()) return null;
        String json = extractJson(reply);
        if (json == null) return null;
        try {
            JSONObject object = new JSONObject(json);
            int score = clamp(object.optInt("score", -1));
            if (score < 0) return null;

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("score", score);
            result.put("level", levelOf(score, object.optString("level", "")));
            result.put("summary", text(object.optString("summary", "")));

            List<Map<String, Object>> dimensions = new ArrayList<>();
            JSONArray dimensionArray = object.optJSONArray("dimensions");
            if (dimensionArray != null) {
                for (int index = 0; index < dimensionArray.length(); index++) {
                    JSONObject item = dimensionArray.optJSONObject(index);
                    if (item == null) continue;
                    String name = text(item.optString("name", ""));
                    if (name.isEmpty()) continue;
                    Map<String, Object> dimension = new LinkedHashMap<>();
                    dimension.put("name", name);
                    dimension.put("score", clamp(item.optInt("score", 0)));
                    dimension.put("comment", text(item.optString("comment", "")));
                    dimensions.add(dimension);
                }
            }
            result.put("dimensions", dimensions);
            result.put("strengths", stringList(object.optJSONArray("strengths")));
            result.put("issues", stringList(object.optJSONArray("issues")));
            result.put("suggestions", stringList(object.optJSONArray("suggestions")));

            Map<String, Object> keywords = new LinkedHashMap<>();
            JSONObject keywordObject = object.optJSONObject("keywords");
            keywords.put("hit", keywordObject == null ? List.of() : stringList(keywordObject.optJSONArray("hit")));
            keywords.put("missing", keywordObject == null ? List.of() : stringList(keywordObject.optJSONArray("missing")));
            result.put("keywords", keywords);

            result.put("generatedAt", java.time.LocalDateTime.now()
                    .format(java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")));
            return result;
        } catch (RuntimeException error) {
            log.warn("简历评估 JSON 解析失败: {}", safeMessage(error));
            return null;
        }
    }

    /** 从回复里抠出 JSON 对象：模型常把 JSON 包在 ```json 里或前后加一句话。 */
    private static String extractJson(String reply) {
        int start = reply.indexOf('{');
        int end = reply.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        return reply.substring(start, end + 1);
    }

    private static int clamp(int value) {
        if (value < 0) return -1;
        return Math.min(100, Math.max(0, value));
    }

    /** 模型给的 level 不靠谱时按分数兜底，保证前端显示一致。 */
    private static String levelOf(int score, String modelLevel) {
        String level = text(modelLevel);
        if (!level.isEmpty() && level.length() <= 4) return level;
        if (score >= 85) return "优秀";
        if (score >= 70) return "良好";
        if (score >= 60) return "及格";
        return "待改进";
    }

    private static List<String> stringList(JSONArray array) {
        if (array == null) return List.of();
        Set<String> values = new LinkedHashSet<>();
        for (int index = 0; index < array.length(); index++) {
            String value = text(array.optString(index, ""));
            if (!value.isEmpty()) values.add(value);
        }
        return List.copyOf(values);
    }

    private static String text(String value) {
        if (value == null) return "";
        String trimmed = value.strip();
        if (trimmed.length() > 400) trimmed = trimmed.substring(0, 400) + "…";
        return trimmed;
    }

    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return error.getClass().getSimpleName();
        return message.length() > 200 ? message.substring(0, 200) + "…" : message;
    }
}
