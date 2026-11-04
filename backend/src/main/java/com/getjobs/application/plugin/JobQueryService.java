package com.getjobs.application.plugin;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 跨平台岗位查询。
 *
 * <p>四个平台的表结构差异很大（Boss 用 {@code job_name} + 文本状态，猎聘/51job 用
 * {@code job_title} + 整数 delivered，智联又是另一套），所以这里把"筛选 + 归一化"
 * 收在一处，导出和使用方都不必知道表的形状。
 *
 * <p>只读：本类不写任何表。数据源是 {@code application.yaml} 里那个 SQLite 文件，
 * 不依赖任何数据库服务。
 */
@Service
public class JobQueryService {

    /** 导出上限。超出部分截断并在响应里说明，避免一次拉爆内存。 */
    public static final int MAX_ROWS = 50_000;

    /** 归一化后的一行岗位。字段顺序即 Excel 列顺序。 */
    public record JobRow(
            String platform,
            String company,
            String title,
            String salary,
            String location,
            String experience,
            String degree,
            String status,
            String hrName,
            String url,
            String createdAt,
            String updatedAt
    ) {}

    /** 一个平台的表名与列名映射。 */
    private record Shape(
            String platform,
            String table,
            String company,
            String title,
            String salary,
            String location,
            String experience,
            String degree,
            String status,
            String hr,
            String url,
            String created,
            String updated,
            boolean booleanStatus
    ) {}

    private static final List<Shape> SHAPES = List.of(
            new Shape("boss", "boss_data", "company_name", "job_name", "salary", "location",
                    "experience", "degree", "delivery_status", "hr_name", "job_url",
                    "created_at", "updated_at", false),
            new Shape("liepin", "liepin_data", "comp_name", "job_title", "job_salary_text", "job_area",
                    "job_exp_req", "job_edu_req", "delivered", "hr_name", "job_link",
                    "create_time", "update_time", true),
            new Shape("51job", "job51_data", "comp_name", "job_title", "job_salary_text", "job_area",
                    "job_exp_req", "job_edu_req", "delivered", "hr_name", "job_link",
                    "create_time", "update_time", true),
            new Shape("zhilian", "zhilian_data", "company_name", "job_title", "salary", "location",
                    "experience", "degree", "delivery_status", "NULL", "job_link",
                    "create_time", "update_time", false)
    );

    private final JdbcTemplate jdbc;

    public JobQueryService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 平台标识是否受支持。 */
    public boolean supports(String platform) {
        return SHAPES.stream().anyMatch(shape -> shape.platform().equals(platform));
    }

    /** 所有受支持的平台标识，顺序固定。 */
    public List<String> platforms() {
        return SHAPES.stream().map(Shape::platform).toList();
    }

    /**
     * 查询岗位。
     *
     * @param platform   平台标识；{@code "all"} 表示全部平台合并
     * @param keyword    公司或岗位关键词，空表示不限
     * @param statuses   投递状态，逗号分隔；空表示不限
     * @param limit      最多返回多少行
     */
    public List<JobRow> query(String platform, String keyword, String statuses, int limit) {
        List<Shape> targets = "all".equals(platform)
                ? SHAPES
                : SHAPES.stream().filter(shape -> shape.platform().equals(platform)).toList();
        if (targets.isEmpty()) {
            throw new IllegalArgumentException("未知平台：" + platform);
        }

        int cap = limit <= 0 ? MAX_ROWS : Math.min(limit, MAX_ROWS);
        List<JobRow> rows = new ArrayList<>();
        for (Shape shape : targets) {
            if (rows.size() >= cap) break;
            rows.addAll(queryOne(shape, keyword, statuses, cap - rows.size()));
        }
        return rows;
    }

    /** 单平台查询。SQL 全部走参数绑定，不拼接用户输入。 */
    private List<JobRow> queryOne(Shape shape, String keyword, String statuses, int limit) {
        StringBuilder sql = new StringBuilder()
                .append("SELECT ")
                .append(shape.company()).append(" AS company, ")
                .append(shape.title()).append(" AS title, ")
                .append(shape.salary()).append(" AS salary, ")
                .append(shape.location()).append(" AS location, ")
                .append(shape.experience()).append(" AS experience, ")
                .append(shape.degree()).append(" AS degree, ")
                .append(shape.status()).append(" AS status, ")
                .append(shape.hr()).append(" AS hr, ")
                .append(shape.url()).append(" AS url, ")
                .append(shape.created()).append(" AS created, ")
                .append(shape.updated()).append(" AS updated")
                .append(" FROM ").append(shape.table())
                .append(" WHERE 1 = 1");

        List<Object> params = new ArrayList<>();

        if (keyword != null && !keyword.isBlank()) {
            sql.append(" AND (").append(shape.company()).append(" LIKE ?")
                    .append(" OR ").append(shape.title()).append(" LIKE ?)");
            String like = "%" + keyword.trim() + "%";
            params.add(like);
            params.add(like);
        }

        List<String> wanted = splitStatuses(statuses);
        if (!wanted.isEmpty()) {
            if (shape.booleanStatus()) {
                // 整数平台只有"已投递/未投递"两种语义，其余状态值无对应列可查。
                List<Object> marks = new ArrayList<>();
                for (String status : wanted) {
                    if (status.contains("已投")) marks.add(1);
                    else if (status.contains("未投")) marks.add(0);
                }
                if (marks.isEmpty()) return List.of();
                sql.append(" AND ").append(shape.status()).append(" IN (")
                        .append(String.join(",", marks.stream().map(item -> "?").toList()))
                        .append(")");
                params.addAll(marks);
            } else {
                sql.append(" AND ").append(shape.status()).append(" IN (")
                        .append(String.join(",", wanted.stream().map(item -> "?").toList()))
                        .append(")");
                params.addAll(wanted);
            }
        }

        sql.append(" ORDER BY ").append(shape.updated()).append(" DESC LIMIT ?");
        params.add(limit);

        return jdbc.query(sql.toString(), (rs, index) -> new JobRow(
                shape.platform(),
                text(rs.getString("company")),
                text(rs.getString("title")),
                text(rs.getString("salary")),
                text(rs.getString("location")),
                text(rs.getString("experience")),
                text(rs.getString("degree")),
                shape.booleanStatus()
                        ? (numberOrZero(rs, "status") == 1 ? "已投递" : "未投递")
                        : blankToDash(rs.getString("status")),
                blankToDash(rs.getString("hr")),
                text(rs.getString("url")),
                text(rs.getString("created")),
                text(rs.getString("updated"))
        ), params.toArray());
    }

    private static int numberOrZero(java.sql.ResultSet rs, String column) {
        try {
            return rs.getInt(column);
        } catch (java.sql.SQLException ignored) {
            return 0;
        }
    }

    private static String text(String value) {
        return value == null ? "" : value;
    }

    private static String blankToDash(String value) {
        return value == null || value.isBlank() ? "—" : value;
    }

    private static List<String> splitStatuses(String statuses) {
        if (statuses == null || statuses.isBlank()) return List.of();
        return java.util.Arrays.stream(statuses.split(","))
                .map(String::trim)
                .filter(item -> !item.isEmpty())
                .toList();
    }
}
