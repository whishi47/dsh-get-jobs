package com.getjobs.application.plugin;

import com.getjobs.application.service.AiService;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 把简历纯文本变成可写回的 AI 配置草稿。
 *
 * <p>调用的是用户在「设置」里配置的那个大模型（{@code BASE_URL / API_KEY / MODEL}），
 * 复用 {@link AiService#sendRequest} 以便同时兼容 Responses 与 Chat Completions 两种端点。
 *
 * <p>三条刻意遵守的约束：
 * <ol>
 *   <li>简历原文既不打日志也不返回给前端，只在内存里走一趟；</li>
 *   <li>模型返回的不是严格 JSON 时降级成"只给自我介绍"，而不是 500；</li>
 *   <li>城市码、薪资码这类需要对照表的值不由模型猜，草稿只给人类可读的建议。</li>
 * </ol>
 */
@Service
public class ResumeDraftService {

    private static final Logger log = LoggerFactory.getLogger(ResumeDraftService.class);

    /** 送进模型的正文上限。12k 已在抽取层截过，这里再兜一层。 */
    private static final int MAX_PROMPT_CHARS = 8_000;

    private final AiService aiService;

    public ResumeDraftService(AiService aiService) {
        this.aiService = aiService;
    }

    /** 草稿：字段名与前端、与写回接口保持一致。 */
    public record Draft(
            String introduce,
            String prompt,
            String sayHi,
            List<String> keywords,
            List<String> cities,
            List<String> notes
    ) {}

    /**
     * 生成草稿。任何异常都不向外抛，改为返回带 notes 的降级草稿，
     * 这样界面永远有东西可看、可编辑。
     */
    public Draft generate(String resumeText) {
        List<String> notes = new ArrayList<>();
        String trimmed = resumeText.length() > MAX_PROMPT_CHARS
                ? resumeText.substring(0, MAX_PROMPT_CHARS)
                : resumeText;
        if (trimmed.length() < resumeText.length()) {
            notes.add("简历较长，已截取前 " + MAX_PROMPT_CHARS + " 字送模型分析。");
        }

        String reply;
        try {
            reply = aiService.sendRequest(buildPrompt(trimmed));
        } catch (RuntimeException error) {
            log.warn("简历解析调用模型失败: {}", safeMessage(error));
            notes.add("调用大模型失败，已改用简历原文生成自我介绍。原因：" + safeMessage(error));
            return fallback(resumeText, notes);
        }

        Draft parsed = parse(reply, notes);
        if (parsed == null) {
            notes.add("模型返回的不是可解析的 JSON，已改用简历原文生成自我介绍。");
            return fallback(resumeText, notes);
        }
        return parsed;
    }

    /** 提示词。要求严格 JSON，字段名固定，避免模型自由发挥。 */
    private static String buildPrompt(String resumeText) {
        return """
                你是求职助手。下面是一份简历的纯文本，请据此生成投递用的配置草稿。

                要求：
                1. 只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。
                2. 字段固定为：
                   - introduce：第一人称自我介绍，120-180 字，突出技能与项目成果，不要写"我是一名"以外的客套话。
                   - prompt：给 AI 用的打招呼提示词，要求根据岗位 JD 写一段50至80个汉字或字符的开场白，提到匹配的技术栈；
                   - sayHi：一句固定的开场白，40 字以内，不出现公司名和岗位名。
                   - keywords：3-6 个招聘网站搜索关键词，字符串数组，按匹配度排序。
                   - cities：1-3 个推荐城市，字符串数组，只写城市名。
                3. 不要编造简历里没有的学历、公司、时间。
                4. 不要输出城市代码、薪资代码这类需要对照表的数字。

                简历文本开始
                ---
                %s
                ---
                简历文本结束
                """.formatted(resumeText);
    }

    /** 解析模型回复；失败返回 null 让调用方走降级路径。 */
    private Draft parse(String reply, List<String> notes) {
        if (reply == null || reply.isBlank()) return null;
        String json = extractJson(reply);
        if (json == null) return null;
        try {
            JSONObject object = new JSONObject(json);
            String introduce = object.optString("introduce", "").strip();
            if (introduce.isEmpty()) return null;
            return new Draft(
                    introduce,
                    object.optString("prompt", "").strip(),
                    object.optString("sayHi", object.optString("say_hi", "")).strip(),
                    stringList(object.optJSONArray("keywords")),
                    stringList(object.optJSONArray("cities")),
                    notes
            );
        } catch (RuntimeException error) {
            log.warn("模型返回的 JSON 解析失败: {}", safeMessage(error));
            return null;
        }
    }

    /**
     * 从回复里抠出 JSON 对象。
     *
     * <p>模型经常把 JSON 包在 ```json 里，或在前后加一句"以下是结果："，
     * 所以按第一个 { 到最后一个 } 截取，比严格 parse 整段更实用。
     */
    private static String extractJson(String reply) {
        int start = reply.indexOf('{');
        int end = reply.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        return reply.substring(start, end + 1);
    }

    private static List<String> stringList(JSONArray array) {
        if (array == null) return List.of();
        Set<String> values = new LinkedHashSet<>();
        for (int index = 0; index < array.length(); index++) {
            String value = array.optString(index, "").strip();
            if (!value.isEmpty()) values.add(value);
        }
        return List.copyOf(values);
    }

    /**
     * 降级草稿：不调模型也能给出可用的自我介绍。
     *
     * <p>取简历前几行做摘要，总比给用户一个空白框强；prompt 用一条固定的通用模板。
     */
    private static Draft fallback(String resumeText, List<String> notes) {
        String excerpt = resumeText.strip();
        if (excerpt.length() > 240) excerpt = excerpt.substring(0, 240) + "…";
        String introduce = excerpt.replace('\n', ' ').strip();
        notes.add("这是从简历原文截取的摘要，建议手工润色后再写回。");
        return new Draft(
                introduce,
                "根据岗位描述提取2-3个匹配的技术关键词，写一段50至80个汉字或字符的自然开场白，不要编造经历。",
                "",
                List.of(),
                List.of(),
                notes
        );
    }

    /** 只保留异常的一句话说明，绝不把请求体或密钥带出去。 */
    private static String safeMessage(Throwable error) {
        String message = error.getMessage();
        if (message == null || message.isBlank()) return error.getClass().getSimpleName();
        return message.length() > 200 ? message.substring(0, 200) + "…" : message;
    }
}
