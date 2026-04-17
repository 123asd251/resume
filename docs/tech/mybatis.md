# MyBatis
## #{} 和 ${} 的区别是什么？
* #{} 会被解析为 JDBC 的 ? 占位符，由 PreparedStatement 处理，能够利用数据库的执行计划缓存，且会自动处理参数的类型转换（TypeHandler）
* ${} 是动态解析阶段的字符串拼接，直接进行字符串替换，会产生安全隐患（SQL 注入）。  
在处理 ORDER BY ${column}、GROUP BY 或者分表名 FROM ${tableName} 时，必须使用 ${}，因为 SQL 语法规定这些位置不能使用占位符。
## 当实体类属性名和数据库字段名不一致时，怎么办？
1. sql别名 最直观，但是每个查询都要写，不便于维护
2. resultMap 可以用result显示映射，适合处理一对一，一对多的关系
## MyBatis 如何执行一对一、一对多关联查询？
* 一对一：通过 association 标签。
* 一对多：通过 collection 标签。
## 如果 XML 里的 ID 重名了怎么办？
如果是在同一个 Namespace 下，绝对不允许 ID 重名，启动时 MappedStatement 的解析就会抛出异常。如果在不同的 Namespace 下，ID 可以重名。MyBatis 使用 namespace + id 作为全局唯一的 MappedStatement 标识。
## 什么是 MyBatis 插件？
mybatis本质是一种拦截器,利用了java的动态代理机制，允许在mybatis执行过程中的某些特定时点进行横切接入。
在mybatis的生命周期中，只允许拦截四个核心对象的方法：
* **Executor**：拦截增删改查、事务提交/回滚、缓存维护。
* **StatementHandler**：拦截sql语句的预编译，参数设置(分页插件通常拦截在这里)
* **ParameterHandler**：拦截参数组装过程
* **ResultSetHandler**：拦截结果集的封装映射。
## 如何实现一个分页插件？
实现一个分页插件，核心逻辑就是：拦截原始 SQL -> 拼装物理分页语句（如 LIMIT） -> 执行物理分页 SQL。
### 1. 定义拦截器类
使用 @Intercepts 注解来声明我们要拦截的对象和方法。
```java
@Intercepts({@Signature(type = StatementHandler.class, method = "prepare", args = {Connection.class, Integer.class})
})
public class MyPaginationInterceptor implements Interceptor {
    
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        // 1. 获取目标对象（StatementHandler）
        StatementHandler statementHandler = (StatementHandler) invocation.getTarget();
        
        // 2. 通过 MetaObject 反射工具获取 BoundSql（原始 SQL 和参数）
        // MyBatis 内部对象嵌套很深，直接反射很痛苦。使用 SystemMetaObject 可以通过属性路径（如 delegate.boundSql.sql）轻松读写私有变量
        MetaObject metaObject = SystemMetaObject.forObject(statementHandler);
        BoundSql boundSql = (BoundSql) metaObject.getValue("delegate.boundSql");
        String sql = boundSql.getSql();

        // 3. 模拟获取分页参数（实际通常从参数对象中取）
        int offset = 0; 
        int limit = 10;

        // 4. 重写 SQL：拼装 MySQL 的 LIMIT 语句
        String pageSql = sql + " LIMIT " + offset + "," + limit;
        
        // 5. 将处理后的分页 SQL 写回 StatementHandler
        metaObject.setValue("delegate.boundSql.sql", pageSql);

        // 6. 执行后续流程
        return invocation.proceed();
    }
}
```
### 2.为什么要用 MetaObject
RoutingStatementHandler 采用了“装饰者”模式，在 MyBatis 运行时，StatementHandler 的默认实现类是 RoutingStatementHandler。它并不负责具体的 SQL 执行，而是根据 MappedStatement 的类型进行路由：
```java
//源码
public class RoutingStatementHandler implements StatementHandler {
// 真正起作用的“委派”对象，该属性是私有的且没有暴露 Getter
  private final StatementHandler delegate;

  public RoutingStatementHandler(Executor executor, MappedStatement ms, Object parameter, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {

    switch (ms.getStatementType()) {
      case STATEMENT:
        delegate = new SimpleStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
        break;
      case PREPARED:
        delegate = new PreparedStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
        break;
      case CALLABLE:
        delegate = new CallableStatementHandler(executor, ms, parameter, rowBounds, resultHandler, boundSql);
        break;
      default:
        throw new ExecutorException("Unknown statement type: " + ms.getStatementType());
    }

  }
}
```
```java

//delegate内部
public interface StatementHandler {

  Statement prepare(Connection connection, Integer transactionTimeout)
      throws SQLException;

  void parameterize(Statement statement)
      throws SQLException;

  void batch(Statement statement)
      throws SQLException;

  int update(Statement statement)
      throws SQLException;

  <E> List<E> query(Statement statement, ResultHandler resultHandler)
      throws SQLException;

  <E> Cursor<E> queryCursor(Statement statement)
      throws SQLException;

  BoundSql getBoundSql();

  ParameterHandler getParameterHandler();

}
```
3. MetaObject 的作用：把“套娃”打平。如果不使用 MetaObject，通过反射修改 SQL 的代码：
```java
// 伪代码：极其麻烦的层层反射
Field delegateField = RoutingStatementHandler.class.getDeclaredField("delegate");
delegateField.setAccessible(true);
StatementHandler handler = (StatementHandler) delegateField.get(routingHandler);
// ...还要再反射获取 boundSql，再反射修改 sql 字段
```
MetaObject 是 MyBatis 提供的高级反射工具类，它的核心优势在于支持表达式路径解析。
当你调用 metaObject.getValue("delegate.boundSql.sql") 时，内部会自动完成：
 1. **定位Delegate**：自动反射获取 RoutingStatementHandler 中的私有 delegate 实例。
    * PreparedStatement：最常用，处理带 ? 占位符的 SQL。
    * SimpleStatementHandler：处理直接拼接字符串的 SQL。
    * CallableStatementHandler：调用存储过程，拿到的就是它。
 2. **穿透 BaseStatementHandler**：delegate 实例通常继承自 BaseStatementHandler，从中找到 boundSql 对象。
 3. **读写目标字段**：最终定位到 BoundSql 实例中的 sql 字段并进行读写。

4. MyBatis 会根据 ExecutorType 的不同（SIMPLE, REUSE, BATCH），在构造方法里给这个 delegate 实例化不同的实现类（比如 PreparedStatementHandler）。所以真正干活的对象（存有 boundSql 的对象）被包裹在 delegate 里面。

在 BaseStatementHandler中，定义了一个成员变量boundSql：
```java
    public abstract class BaseStatementHandler implements StatementHandler {

    protected final Configuration configuration;
    protected final ObjectFactory objectFactory;
    protected final TypeHandlerRegistry typeHandlerRegistry;
    protected final ResultSetHandler resultSetHandler;
    protected final ParameterHandler parameterHandler;
    protected final Executor executor;
    protected final MappedStatement mappedStatement;
    protected final RowBounds rowBounds;

    protected BoundSql boundSql;
    }
```
这个对象的里面存储的就是：
* sql
* parameterMapping：参数映射关系
* parameterObject：传进来的参数实例
```java
public class BoundSql {

  private final String sql;
  private final List<ParameterMapping> parameterMappings;
  private final Object parameterObject;
  private final Map<String, Object> additionalParameters;
  private final MetaObject metaParameters;

  public BoundSql(Configuration configuration, String sql, List<ParameterMapping> parameterMappings, Object parameterObject) {
    this.sql = sql;
    this.parameterMappings = parameterMappings;
    this.parameterObject = parameterObject;
    this.additionalParameters = new HashMap<>();
    this.metaParameters = configuration.newMetaObject(additionalParameters);
  }
}
```
5. 总结：
    1. 物理层面：拿到的是一个位于堆内存中的 Java 对象实例（比如 PreparedStatementHandler）。
    2. 逻辑层面：拿到了 SQL 的操作权。
6. 参数组装：
    1. 当通过 metaObject.setValue("delegate.boundSql.sql", newSql) 修改了 SQL 字符串时，只是改了那段文本。BoundSql 对象内部还维护着一个ParameterMapping集合，这里面记录了原 SQL 里每个 ? 对应的 Java 属性名、类型等信息。只要没有动这个 List，原有的 where id = ? 对应的参数逻辑依然有效。
    2. 当把offset limit参数拼接到后面时，形式是limit ? ?,就必须手动往boundSql里面的参数列表追加映射，否则mybatis在后面执行ParameterHandler时，会发现SQL有三个？,但参数表可能只有一个，会直接报数组下标越界。
    3. 修改完了参数列表，需要在ParameterObject对象中添加值。一般直接用Map即可。
7. 总结：
    SQL文本和参数映射列表是分离的，必须一一对应。修改了SQL中的问号数量，必须修改映射表。

## MyBatis 的拦截器是如何工作的？Invocation 对象的作用是什么?
### mybatis拦截器的工作原理：插件链（InterceptorChain）
1. mybatis的拦截器不是直接硬编码在执行流程里面的，他是一层层套娃式的代理实现的。
    1.  **初始化阶段**：当mybatis启动加载配置时，会把所有的Interceptor注册到InterceptorChain中
    2. **核心对象创建**：当mybatis创建四大核心对象时(Executor,StatementHandler等)时，会调用intercrptorChain.pluginAll(target)方法。
    3. **动态代理织入**：这个pluginAll方法会遍历所有的插件，执行plugin方法。使用jdk动态代理模式为目标对象生成代理类。如果拦截了三个插件，statementHandler会套上三层代理。
    4. **执行阶段**：当调用Query或者prepare()时，其实是在调用最外层的代理方法。会先走拦截器里面的逻辑，再决定是否往下执行。
2. 源码解析
    1. 在package org.apache.ibatis.session下面有个Configuration类，当mybatis创建四大核心对象时(Executor,StatementHandler等)时，都会调用下面的方法：
    ```java
     public StatementHandler newStatementHandler(Executor executor, MappedStatement mappedStatement, Object parameterObject, RowBounds rowBounds, ResultHandler resultHandler, BoundSql boundSql) {
        StatementHandler statementHandler = new RoutingStatementHandler(executor, mappedStatement, parameterObject, rowBounds, resultHandler, boundSql);
        statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);
        return statementHandler;
        }
    ```
    2. 进入InterceptorChain.java 内部：
    ```java
    public class InterceptorChain {

        private final List<Interceptor> interceptors = new ArrayList<>();

        public Object pluginAll(Object target) {
            for (Interceptor interceptor : interceptors) {
            target = interceptor.plugin(target);
            }
            return target;
        }

        public void addInterceptor(Interceptor interceptor) {
            interceptors.add(interceptor);
        }

        public List<Interceptor> getInterceptors() {
            return Collections.unmodifiableList(interceptors);
        }
    }
    // target = interceptor.plugin(target);是接口默认方法
    default Object plugin(Object target) {
        return Plugin.wrap(target, this);
    }
    ```
    通常我们的插件会调用 Plugin.wrap(target, this)。这个 Plugin 类实现了 InvocationHandler。它内部执行的就是 Proxy.newProxyInstance(...)。

    ```java
    //mybatis的插件实现源码
    public class Plugin implements InvocationHandler {

        private final Object target;
        private final Interceptor interceptor;
        private final Map<Class<?>, Set<Method>> signatureMap;

        private Plugin(Object target, Interceptor interceptor, Map<Class<?>, Set<Method>> signatureMap) {
            this.target = target;
            this.interceptor = interceptor;
            this.signatureMap = signatureMap;
        }

        public static Object wrap(Object target, Interceptor interceptor) {
            //这个interceptor就是自定义拦截器对象
            Map<Class<?>, Set<Method>> signatureMap = getSignatureMap(interceptor);
            Class<?> type = target.getClass();
            Class<?>[] interfaces = getAllInterfaces(type, signatureMap);
            if (interfaces.length > 0) {
            return Proxy.newProxyInstance(
                type.getClassLoader(),
                interfaces,
                new Plugin(target, interceptor, signatureMap));
            }
            return target;
        }   
    }
    ```
    所以configuration中statementHandler = (StatementHandler) interceptorChain.pluginAll(statementHandler);返回的其实是代理对象，实际调用statementHandler.prepare(...)方法时，真正执行的是 Plugin.invoke() 方法(这是整个流程最核心的点，为什么能使用invoke方法，这是关于动态代理的，点击这个链接详细解读)
    ```java
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        try {
            // 1. 获取该插件定义的所有拦截方法（通过 @Signature 注解）
            //signatureMap通过getSignatureMap()反射方法获取所有被拦截方法的注解
            //当执行方法时，再通过注解获取所有标注注解的方法。
        Set<Method> methods = signatureMap.get(method.getDeclaringClass());
        // 2. 如果当前调用的方法（比如 prepare）在拦截范围内
        if (methods != null && methods.contains(method)) {
            // 3. 构建 Invocation 对象，把目标对象、方法、参数打包
            // 这里的 target 可能是原始对象，也可能是上一个插件生成的代理对象(如果有多层代理)
            //interceptor:正是定义的那个 MyPaginationInterceptor 实例。
            //intercept(...): 正是重写的那个intercept(Invocation invocation) 方法.
            return interceptor.intercept(new Invocation(target, method, args));
        }
        // 4. 如果不在拦截范围内，直接反射调用
        return method.invoke(target, args);
        } catch (Exception e) {
        throw ExceptionUtil.unwrapThrowable(e);
        }
    }
    ```
* 如果是最后一个 拦截器，这里的target就是那个真实的 RoutingStatementHandler，proceed() 就会去执行数据库预编译逻辑。

* 如果前面还有拦截器，这里的 target 其实是 上一个插件生成的代理对象。调用 method.invoke 会再次触发那个插件的 Plugin.invoke()。这就形成了一个递归式的责任链：拦截器C -> 拦截器B -> 拦截器A -> 目标对象方法。

**总结**：
* **注入瞬时** ：在 SqlSessionFactory 启动时，拦截器就被排好队放进 InterceptorChain 了。
* **织入瞬时**：在执行每个 SQL 请求，创建 StatementHandler 时，通过 JDK 动态代理把拦截器逻辑“穿”在对象身上。
* **触发瞬时**：当 Plugin.invoke 命中注解声明的方法时，流程从普通的执行跳转到你的 intercept 方法中。
## 如何动态修改 SQL？有哪些性能优化的注意点？
### 动态修改sql三步：
1. **定位BoundSql**：
    在intercept方法中，通过invocation拿到StatementHandler,再用MetaObject反射获取delegate.boundSql
2. **提取并加工sql**：
    拿到sql后，可以用字符串拼接。
3. **回填sql**：
    通过 metaObject.setValue("delegate.boundSql.sql", modifiedSql) 将新 SQL 塞回去。
### 性能优化
1. **避免昂贵的字符串操作**：
    使用复杂的正则表达式或者复杂的字符串替换非常消耗CPU
2. **警惕预编译失效**：
    尽量使用占位符，同时同步修改ParameterMappings
3. **插件逻辑要快进快出**： 
    插件拦截的是每条sql，因此要快速，避免IO操作，配置信息或者权限数据，尽量从缓存中读取。
## MyBatis 分页插件的实现原理是什么?
1. 这是mybatis的分页插件的签名定义：
```java
@Intercepts({
    @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class}),
    @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class, CacheKey.class, BoundSql.class}),
})
public class PageInterceptor implements Interceptor { ... }
```
通过注解，可以看到拦截的是Executor，拦截Executor可以在mybatis还没处理缓存时，还没生成Statementhandler之前就能介入，这样就可以处理自动生成的Count语句。
2. 核心入口：intercept方法
当调用Mapper注解标注的方法时，会进入动态代理的PageInterceptor.intercept(Invocation invocation)方法。
1. **提取分页参数**
    * 它会先尝试通过 PageHelper.getLocalPage() 从 ThreadLocal 中获取分页信息。
    * 代码里写了 PageHelper.startPage(1, 10)，参数就在这里被拿出来。
2. **判断是否需要执行 Count 查询**   
    源码中会判断 Page 对象里的 count 属性。如果为 true，它会调用一个名为 executeAutoCount 的私有方法。它会克隆当前的 MappedStatement，给它生成一个专门的 _COUNT 结尾的 ID，然后利用 JSqlParser 把你的 SELECT * FROM ... 动态改写成 SELECT count(0) FROM ...。
3. **执行分页查询**  
    PageHelper 定义了一个 Dialect（数据库方言） 接口。  
    1.它会根据你连接的是 MySQL 还是 Oracle，找对应的实现类（如 MySqlDialect）。  
    2.调用 dialect.getPageSql(...)。
4. **清理线程**  
    在 finally 块中，它一定会执行 afterAll()，最重要的一件事就是：  
    ```java

    SqlUtil.clearLocalPage(); // 其实就是 ThreadLocal.remove()

    //因为 Tomcat 等 Web 容器使用的是线程池。如果这次请求报错了没清理，
    //下次请求复用这个线程时，可能会莫名其妙地被执行了分页逻辑，造成生产事故
    ```
### 用了 ThreadLocal，那如果在 startPage 之后、执行查询之前，代码抛了异常，会发生什么？(踩坑点)
会导致 ThreadLocal 没有被清理。虽然 PageHelper 在 intercept 内部有 finally 清理，但如果程序根本没跑到查询那一步就崩了，这个线程就被‘污染’了。所以startPage 要紧跟查询语句

**总结：**
1. 利用 ThreadLocal 传递参数：解决了 Mapper 接口定义中没有分页参数的尴尬。
2. 拦截 Executor.query：在 MyBatis 执行最外层进行拦截。
3. 动态克隆 MappedStatement：实现了一次查询、两次执行（Count + List）。
4. 方言（Dialect）适配：通过配置自动识别数据库，拼接不同的分页后缀。
## 如何支持不同数据库的分页方言?
大多数方言都继承AbstractHelperDialect这个类，这个类实现的核心接口是Dialect。它封装了通用的逻辑，比如获取分页参数，处理JsqlParser的解析逻辑等等。
在PaheHelper初始化时，会根据url判断数据库类型。然后根据数据库类型拼接SQL。
### 自定义实现方言类
```java
package com.yourcompany.dialect;

import com.github.pagehelper.Page;
import com.github.pagehelper.dialect.AbstractHelperDialect;
import org.apache.ibatis.cache.CacheKey;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.mapping.MappedStatement;

public class MyCustomDialect extends AbstractHelperDialect {
    @Override
    public Object processPageParameter(MappedStatement ms, Object parameterObject, BoundSql boundSql, CacheKey pageKey, Page page) {
        // 处理分页参数，比如把 startRow, pageSize 放入参数映射
        return super.processPageParameter(ms, parameterObject, boundSql, pageKey, page);
    }

    @Override
    public String getPageSql(String sql, Page page, CacheKey pageKey) {
        // 假设这是一个特殊的 SQL 方言，使用 OFFSET ... FETCH
        return sql + " OFFSET " + page.getStartRow() + " ROWS FETCH NEXT " + page.getPageSize() + " ROWS ONLY";
    }
}
//在配置中开启
pagehelper:
  helperDialect: com.yourcompany.dialect.MyCustomDialect
  autoRuntimeDialect: true # 如果是多数据源，开启运行时自动识别。autoRuntimeDialect=true 的原理是每次从 DataSource 获取连接并判断 URL
```
## 分页查询时如何优化性能？
### 针对Count语句的优化
PageHelper 默认会执行一次 SELECT COUNT(0)。当数据量达到千万级时，这个 COUNT 可能会耗时数秒。  
* **手动覆盖 Count 查询：**  
PageHelper 支持在 Mapper 中定义一个 ID + _COUNT 的方法。你可以手动写一个优化后的 Count SQL，比如去掉不必要的左连接（Left Join），或者直接查另一张汇总表。
* **估算总数（非精确分页）：** 
如果业务场景允许，可以不查总数。在 PageHelper.startPage(pageNum, pageSize, false) 中将第三个参数设为 false。或者通过物理采样、查看数据库元数据（如 MySQL 的 explain 里的 rows）来给用户一个模糊的总数。
* **缓存总数：**  
对于变动不频繁的数据，将 total 缓存到 Redis 中，失效时间设为 5 分钟。
### 深分页问题
当执行limit 1000000 10时，Mysql会扫描前1000010行，然后扔掉1000000行，这会产生大量随机I/O。
1. **延迟关联**
```java
先通过覆盖索引只查询主键 ID，再回表查询具体行数据,子查询只扫描索引而不回表，极大地减少磁盘访问.
-- 优化前
SELECT * FROM orders WHERE user_id = 123 ORDER BY create_time LIMIT 1000000, 10;

-- 优化后
SELECT o.* FROM orders o
JOIN (
    SELECT id FROM orders WHERE user_id = 123 ORDER BY create_time LIMIT 1000000, 10
) AS tmp ON o.id = tmp.id;
```
2. **滚动分页**
```java
-- 通过 ID 过滤，直接跳过前面的数据
SELECT * FROM orders 
WHERE user_id = 123 AND id < [last_id_from_previous_page] 
ORDER BY id DESC 
LIMIT 10;

-- last_id_from_previous_page是上一页最后一条数据的唯一标识
```
这些只是相对的一种优化方案，对于海量数据的分页可以从设计上不允许翻到100页以后或者考虑分库分表，主备分离等方案。不同的情景会有不同的方案。我们需要通过慢查询日志定位到具体是Count慢还是limit慢。如果是Count慢，可以考虑总数查询或者使用Redis缓存。如果是limit慢，可以采用延迟关联或者滚动id策略，或者在设计上限制最大翻页数。
## mybatis的核心执行流程？
1. **初始化阶段**
这个阶段的目标是生成 SqlSessionFactory。
```java
 -- SqlSessionFactoryBuilder 调用 XMLConfigBuilder 解析 mybatis-config.xml 和所有的 Mapper.xml

 public SqlSessionFactory build(Reader reader, String environment, Properties properties) {
    try {
      XMLConfigBuilder parser = new XMLConfigBuilder(reader, environment, properties);
      //这里加载xml配置
      return build(parser.parse());
    } catch (Exception e) {
      throw ExceptionFactory.wrapException("Error building SqlSession.", e);
    } finally {
      ErrorContext.instance().reset();
      try {
        reader.close();
      } catch (IOException e) {
        // Intentionally ignore. Prefer previous error.
      }
    }
  }

 public Configuration parse() {
    if (parsed) {
      throw new BuilderException("Each XMLConfigBuilder can only be used once.");
    }
    parsed = true;
    //读取指定路径下的配置文件
    parseConfiguration(parser.evalNode("/configuration"));
    return configuration;
  }

  private void parseConfiguration(XNode root) {
    try {
      // 读取xml文件的各种节点信息
      propertiesElement(root.evalNode("properties"));
      Properties settings = settingsAsProperties(root.evalNode("settings"));
      loadCustomVfs(settings);
      loadCustomLogImpl(settings);
      typeAliasesElement(root.evalNode("typeAliases"));
      pluginElement(root.evalNode("plugins"));
      objectFactoryElement(root.evalNode("objectFactory"));
      objectWrapperFactoryElement(root.evalNode("objectWrapperFactory"));
      reflectorFactoryElement(root.evalNode("reflectorFactory"));
      settingsElement(settings);
      // read it after objectFactory and objectWrapperFactory issue #631
      environmentsElement(root.evalNode("environments"));
      databaseIdProviderElement(root.evalNode("databaseIdProvider"));
      typeHandlerElement(root.evalNode("typeHandlers"));
      mapperElement(root.evalNode("mappers"));
    } catch (Exception e) {
      throw new BuilderException("Error parsing SQL Mapper Configuration. Cause: " + e, e);
    }
  }
  ```
2. Configuration的addMappedStatement()加载xml标签。  
每一个 <select|update|delete|insert> 标签都会被封装成一个 MappedStatement 对象，存在 Configuration 对象的mappedStatements（一个 HashMap）里。
```java
 public void addMappedStatement(MappedStatement ms) {
    //加载对象的mappedStatements对象
    mappedStatements.put(ms.getId(), ms);
  }
```
3. **SQL四步走**  
当调用Mapper.select()时，就会触发上面的拦截器流程：  
    1. 代理对象触发MapperProxy.invoke()方法
    2. SqlSession与Executor层。SqlSession默认是DefaultSqlSession会把请求转发给Executor。
    3. StatementHandler的创建与拦截，上面插件自定义介入的位置。
    4. BoundSql的解析与拼接。
如果没有定义mapper接口，直接使用SqlSession.selectList()查询，就不会触发动态代理，后面的流程是一样的。  
4. **总结:**  
MyBatis 将 参数处理、SQL 准备、结果映射 拆分成四个独立的对象（Executor, StatementHandler, ParameterHandler, ResultSetHandler），是为了实现高度的可扩展性。
所有的插件（Interceptor）本质上都是通过动态代理，在这些对象的方法执行前后“横插一脚”。 这种设计体现了开闭原则（对扩展开放，对修改关闭）。
## mybatis的一级二级缓存是什么？在高并发场景或者分布式环境下有什么坑？
### 一级缓存
* **原理**
一级缓存默认开启，其本质是一个简单的 HashMap，存在于 BaseExecutor 对象的 localCache 字段中。
* **作用域**
在同一个sqlsession声明周期内有效（可以简单的理解为数据库连接）
* **源码触发点**
在 BaseExecutor.query() 方法中：
```java
// 源码核心逻辑
list = resultHandler == null ? (List<E>) localCache.getObject(key) : null;
if (list != null) {
    // 直接从本地缓存拿
} else {
    // 查数据库并放入 localCache
    list = queryFromDatabase(ms, parameter, rowBounds, resultHandler, key, boundSql);
}
```
* **失效条件**
1. 执行了任何 insert/update/delete 操作（无论是否提交，都会 clearLocalCache）。
2. 手动调用了 sqlSession.clearCache()
3. SqlSession 关闭。
### 二级缓存
* **原理**
二级缓存需要手动开启（<cache/> 标签），它的生命周期跨越多个 SqlSession，只要是同一个 Namespace 即可共享。
* **作用域**

* **源码触发点**
使用了 装饰器模式。MyBatis 会用 CachingExecutor 去装饰普通的 Executor。
```java
// CachingExecutor.query() 源码
Cache cache = ms.getCache();
if (cache != null) {
    flushCacheIfRequired(ms); // 如果配置了 flushCache=true，先清缓存
    List<E> list = (List<E>) tcm.getObject(cache, key); // 从事务缓存管理器拿
    if (list == null) {
        //缓存不存在就去数据库查
        list = delegate.query(ms, parameterObject, rowBounds, resultHandler, key, boundSql);
        tcm.putObject(cache, key, list); // 查完存入
    }
    return list;
}
-- 二级缓存的数据必须在 SqlSession 提交（commit） 后才会真正刷入缓存空间。如果不 commit，其他会话是看不到的。
```
### 分布式环境下的坑
重点在**数据不一致性**
**分布式环境下的脏读**
* **坑点**：MyBatis 的二级缓存是本地内存缓存（由 PerpetualCache 实现）。在分布式集群下，节点 A 修改了数据并清空了自己的二级缓存，但节点 B 的二级缓存里还是老数据。
* **后果**：用户在不同节点访问时，会看到不一致的数据。
* **解决方案**：禁用二级缓存，采用Redis缓存。（通过实现 MyBatis 的 Cache 接口，将数据存入 Redis，确保所有节点共享同一份缓存）
## mybatis的延迟加载原理和实现
### 应用场景
假设有一个“用户-订单（1:N）”的结构：
* **不开启延迟加载**：查询用户时，会立即触发另一条sql把订单数据全部查询出来，但是如果不需要查询订单数据，只展示用户信息，性能就会浪费。
* **开启延迟加载**：查询用户时，只执行一条sql，只有当代码里面调用user.getOrder()时，才会去执行sql查询。
### 底层实现原理
mybatis通过动态代理技术劫持实体类，当开启延迟查询时返回的代理子类。这个代理类重写了实体类的所有方法，当调用getOrders()方法时，拦截器会判断这个属性是否加载，如果未加载，拦截器会拿到初始化生成MappedStatement,偷偷执行一次查询，并把结果返回。获取到结果后，再执行原本的get逻辑返回数据。
### 关键配置
在maybatis-config.xml文件中配置
```java
<settings>
    <setting name="lazyLoadingEnabled" value="true"/>
    <setting name="aggressiveLazyLoading" value="false"/>
    <setting name="lazyLoadTriggerMethods" value="equals,clone,hashCode,toString"/>
</settings>
```
在 Mapper.xml 中，必须使用 select 属性 的嵌套查询模式：
```java
<resultMap id="userMap" type="User">
    <id property="id" column="id"/>
    <collection property="orders" column="id" select="com.example.mapper.OrderMapper.findByUserId"/>
</resultMap>
```
**总结**  
* 序列化陷阱：代理对象在进行 JSON 序列化（比如 Spring MVC 返回结果给前端）时，Jackson 等工具会调用所有的 get 方法。这会导致延迟加载瞬间失效，甚至产生大量的“1+N”查询压力，把数据库刷爆。
* SqlSession 关闭问题：延迟加载依赖于 SqlSession。如果在 Service 层已经关闭了 SqlSession，但在 Controller 层才去调用 getOrders()，会抛出 ExecutorException，因为连接已经断开了。
* 性能权衡：如果大部分业务场景都需要订单数据，建议直接使用 JOIN 关联查询（一条 SQL 搞定）。只有在关联数据较大且偶尔使用的场景下，才考虑延迟加载。
* 延迟加载的本质是动态代理。MyBatis 通过拦截 getter 方法，在感知到属性为空且需要加载时，利用保存的上下文信息二次执行 SQL。在实际项目中，慎用这个特性。优先考虑 SQL 优化和按需定义 DTO，因为延迟加载如果管理不当，很容易引入不可控的数据库访问和会话过期问题。
## 如何处理海量的数据插入或查询。
### 海量数据插入
1. ExecutorType.BATCH。这是 MyBatis 官方最推崇的方式。它不会在每执行一条 SQL 时都去预编译和发送，而是将 SQL 积攒在客户端，最后统一发送。
```java
// 开启 BATCH 模式的 SqlSession
try (SqlSession sqlSession = sqlSessionFactory.openSession(ExecutorType.BATCH, false)) {
    UserMapper mapper = sqlSession.getMapper(UserMapper.class);
    for (int i = 0; i < 100000; i++) {
        //执行的添加数据
        mapper.insertUser(users.get(i));
        if (i % 1000 == 0) { // 每 1000 条刷一次盘，防止内存撑爆
            sqlSession.commit();
            sqlSession.clearCache(); // 清理一级缓存，非常重要！
        }
    }
    sqlSession.commit();
}
-- 底层调用 JDBC 的 ps.addBatch() 和 ps.executeBatch()。它只编译一次 SQL，减少了网络 IO 和数据库解析开销。
-- 必须手动 clearCache()。因为 MyBatis 的一级缓存会持有所有插入对象的引用，不清理会导致插入越多内存占用越高，最后 OOM.
```
2. foreach 动态 SQL
* 适用场景：数据量级在万级以下。
* 缺点：SQL 长度有限制（max_allowed_packet），且数据库解析超长字符串非常耗 CPU。
```java
<insert id="batchInsert">
    INSERT INTO users (name, age) VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.name}, #{item.age})
    </foreach>
</insert>
```
### 海量查询
MyBatis 3.4.0 之后引入了 Cursor 接口，它支持通过迭代器一条条从数据库拉取数据，而不会一次性加载。
它劫持了 ResultSet 的读取过程。只有当你迭代到下一条时，它才调用 rs.next()。必须保持 SqlSession 开启直到处理完成，因此通常需要配合 @Transactional 使用。
```java
-- Mapper 接口：
@Select("SELECT * FROM heavy_data")
Cursor<DataEntity> scanAll();

-- service调用
// 必须在事务中执行，保证 SqlSession 不会被立即关闭
@Transactional
public void processData() {
    try (Cursor<DataEntity> cursor = mapper.scanAll()) {
        cursor.forEach(data -> {
            // 处理逻辑，内存占用极低
            doProcess(data);
        });
    }
}
```
