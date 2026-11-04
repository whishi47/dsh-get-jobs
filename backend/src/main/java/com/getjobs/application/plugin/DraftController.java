package com.getjobs.application.plugin;

import com.getjobs.application.service.AiService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.CrossOrigin;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 把简历草稿写回真实配置。
 *
 * <p>写两个地方：
 * <ul>
 *   <li>{@code ai} 表——{@code introduce} 与 {@code prompt}，Boss 的 AI 打招呼读这里；</li>
 *   <li>{@code boss_config} 表——{@code say_hi} 与 {@code keywords}，关闭 AI 时的固定招呼语和搜索词。</li>
 * </ul>
 *
 * <p>只更新请求里明确给出的字段：没传的保持原值，传空字符串的才是"清空"。
 * 这样用户在草稿里只改了一句招呼语，不会顺手把提示词抹掉。
 */
@RestController
@RequestMapping("/api/ai")
@CrossOrigin(origins = "*")
public class DraftController {

    private static final Logger log = LoggerFactory.getLogger(DraftController.class);

    private final AiService aiService;
    private final JdbcTemplate jdbc;

    public DraftController(AiService aiService, JdbcTemplate jdbc) {
        this.aiService = aiService;
        this.jdbc = jdbc;
    }

    /** 写回草稿。 */
    @PostMapping("/apply-draft")
    public ResponseEntity<Map<String, Object>> apply(@RequestBody Map<String, Object> body) {
        String introduce = stringOrNull(body.get("introduce"));
        String prompt = stringOrNull(body.get("prompt"));
        String sayHi = stringOrNull(body.get("sayHi"));
        List<String> keywords = stringList(body.get("keywords"));

        if (introduce == null && prompt == null && sayHi == null && keywords.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("message", "没有需要写回的字段。"));
        }

        List<String> changed = new ArrayList<>();

        if (introduce != null || prompt != null) {
            var current = aiService.getAiConfig();
            String nextIntroduce = introduce != null ? introduce : current.getIntroduce();
            String nextPrompt = prompt != null ? prompt : current.getPrompt();
            aiService.saveOrUpdateAiConfig(nextIntroduce, nextPrompt);
            if (introduce != null) changed.add("ai.introduce");
            if (prompt != null) changed.add("ai.prompt");
        }

        boolean bossTouched = sayHi != null || !keywords.isEmpty();
        if (bossTouched) {
            boolean updated = updateBossConfig(sayHi, keywords.isEmpty() ? null : String.join(",", keywords));
            if (updated) {
                if (sayHi != null) changed.add("boss_config.say_hi");
                if (!keywords.isEmpty()) changed.add("boss_config.keywords");
            } else {
                log.warn("boss_config 没有可更新的行，跳过招呼语与关键词写回");
            }
        }

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("changed", changed);
        response.put("message", changed.isEmpty()
                ? "没有实际变更，请检查提交的字段。"
                : "已写回 " + String.join("、", changed) + "；下次启动投递时生效。");
        return ResponseEntity.ok(response);
    }

    /** 只更新给定列，未给出的保持原值。返回是否命中了行。 */
    private boolean updateBossConfig(String sayHi, String keywords) {
        StringBuilder sql = new StringBuilder("UPDATE boss_config SET updated_at = ?");
        List<Object> params = new ArrayList<>();
        params.add(LocalDateTime.now().toString());
        if (sayHi != null) {
            sql.append(", say_hi = ?");
            params.add(sayHi);
        }
        if (keywords != null) {
            sql.append(", keywords = ?");
            params.add(keywords);
        }
        sql.append(" WHERE id = (SELECT MAX(id) FROM boss_config)");
        return jdbc.update(sql.toString(), params.toArray()) > 0;
    }

    /**
     * 取出字符串字段。空串与纯空白一律当成"没传"，即不修改原值。
     *
     * <p>这是有意的保守选择：前端会把草稿原样回传，模型偶尔产不出某一段就会是空串，
     * 若把空串当"清空"，用户原来的提示词会被无声抹掉。
     */
    private static String stringOrNull(Object value) {
        if (value == null) return null;
        String text = String.valueOf(value).strip();
        return text.isEmpty() ? null : text;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream()
                .map(item -> item == null ? "" : String.valueOf(item).strip())
                .filter(item -> !item.isEmpty())
                .toList();
    }
}
