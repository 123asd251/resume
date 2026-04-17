# 动态数据源切换
**核心骨架:AbstractRoutingDataSource**  
不管是自己写还是用第三方的插件，所有的动态数据源切换在 Spring 体系下都离不开这个抽象类。
它实现了DataSource接口。当执行sql需要获取Connection时，他会调用getConnection()方法
AbstractRoutingDataSource 内部持有一个 Map<Object, Object> targetDataSources。它定义了一个抽象方法 determineCurrentLookupKey()。
需要实现determineCurrentLookupKey()，返回一个key(比如“master”，“slave”),它去 Map 里找到对应的真正 DataSource（如 Druid 或 Hikari）。调用该数据源的 getConnection()。
```java
protected DataSource determineTargetDataSource() {
		Assert.notNull(this.resolvedDataSources, "DataSource router not initialized");
		Object lookupKey = determineCurrentLookupKey();
		DataSource dataSource = this.resolvedDataSources.get(lookupKey);
		if (dataSource == null && (this.lenientFallback || lookupKey == null)) {
			dataSource = this.resolvedDefaultDataSource;
		}
		if (dataSource == null) {
			throw new IllegalStateException("Cannot determine target DataSource for lookup key [" + lookupKey + "]");
		}
		return dataSource;
	}
```
## 底层原理
最通用的做法是利用 ThreadLocal 来存储当前线程需要用的数据源 Key。
```java
public class DynamicDataSourceContextHolder {
    private static final ThreadLocal<String> CONTEXT_HOLDER = new ThreadLocal<>();

    public static void setDataSourceKey(String key) { CONTEXT_HOLDER.set(key); }
    public static String getDataSourceKey() { return CONTEXT_HOLDER.get(); }
    public static void clear() { CONTEXT_HOLDER.remove(); }
}
```
定义一个注解 @DataSource("slave")，通过 AspectJ 在 Service 方法执行前，读取注解值并存入 ThreadLocal；方法执行完后，必须清空（防止线程池污染）。
## 事务失效:为什么开启了 @Transactional 之后，数据源切换就失效了？
1. Spring 的事务管理是在 PlatformTransactionManager 中开启的。  
2. 开启事务时，它会先调用 dataSource.getConnection() 获取连接，并将其绑定到 ThreadLocal（为了保证整个事务内用同一个连接）。  
3. 一旦连接被绑定，后续在这个事务内的所有 SQL 都会复用这个连接。哪怕你在方法中间通过 AOP 改了 DynamicDataSourceContextHolder 的 Key，也没用了，因为连接已经拿到了。
**解决方案**：  
1. **切换点前移**：确保数据源切换的切面优先级（@Order）高于事务切面。但这只能解决进入方法前的切换。
2. **事务传播机制**：如果非要在事务里换库，必须开启新事务 @Transactional(propagation = Propagation.REQUIRES_NEW)，强制让它重新去执行一次 getConnection()。 
**总结**：  
动态数据源的核心是利用 Spring 提供的 AbstractRoutingDataSource 结合 ThreadLocal。在使用中需要注意线程池环境的上下文清理和事务状态下失效的问题。
# 使用Mybatis拦截器实现读写自动分离
1. 定义路由标记
```java
public class DynamicContextHolder {
    // 写库标记
    public static final String WRITE = "WRITE";
    // 读库标记
    public static final String READ = "READ";
    
    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    public static void set(String type) { CONTEXT.set(type); }
    public static String get() { return CONTEXT.get(); }
    public static void clear() { CONTEXT.remove(); }
}
```
2. 实现 MyBatis 自动路由拦截器,拦截 Executor 的 update 和 query 方法
```java
@Intercepts({
    @Signature(type = Executor.class, method = "update", args = {MappedStatement.class, Object.class}),
    @Signature(type = Executor.class, method = "query", args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class})
})
public class AutoRoutingInterceptor implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        // 1. 获取当前执行的方法参数
        Object[] args = invocation.getArgs();
        MappedStatement ms = (MappedStatement) args[0];

        // 2. 判断 SQL 类型
        // 如果已经手动设置了（比如某些强制读主库的场景），则不自动覆盖
        if (DynamicContextHolder.get() == null) {
            if (ms.getSqlCommandType() == SqlCommandType.SELECT) {
                // 特殊处理：如果是 select ... for update，必须走写库（主库）
                if (ms.getId().contains("selectForUpdate") || isForUpdate(ms)) {
                    DynamicContextHolder.set(DynamicContextHolder.WRITE);
                } else {
                    DynamicContextHolder.set(DynamicContextHolder.READ);
                }
            } else {
                // INSERT, UPDATE, DELETE 走写库
                DynamicContextHolder.set(DynamicContextHolder.WRITE);
            }
        }

        try {
            return invocation.proceed();
        } finally {
            // 3. 必须清理，防止污染线程池
            DynamicContextHolder.clear();
        }
    }
}
```
## 读写分离的问题
1. 事务一致性
* 如果在用一个@Transactional事务里,先执行了update的，接着执行了select，按照上述逻辑select会去从库读取，但因为主从同步有延迟，就读不到更新的数据。
* 因此对于上述情况，一旦开启事务，就全量走主库。在拦截器里增加逻辑：检查当前是否存在 Spring 事务（使用 TransactionSynchronizationManager.isActualTransactionActive()）。如果是事务中，强制设为 WRITE
2. 主从延迟
* 有些业务对实时性要求极高，虽然没开事务，但也必须读主库。  
* 保留 @Master 强制注解。拦截器逻辑：如果发现当前线程已经被注解显式指定了 WRITE，则拦截器不再自动修改。


