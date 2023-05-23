import {
  Api,
  Config,
  Bucket,
  use
} from '@serverless-stack/resources'
import { UploadDbStack } from './upload-db-stack.js'
import { CarparkStack } from './carpark-stack.js'
import { UcanInvocationStack } from './ucan-invocation-stack.js'

import { getCustomDomain, getApiPackageJson, getGitInfo, setupSentry, getBucketConfig } from './config.js'

/**
 * @param {import('@serverless-stack/resources').StackContext} properties
 */
export function UploadApiStack({ stack, app }) {
  stack.setDefaultFunctionProps({
    srcPath: 'upload-api'
  })

  // Setup app monitoring with Sentry
  setupSentry(app, stack)

  // Get references to constructs created in other stacks
  const { carparkBucket } = use(CarparkStack)
  const { storeTable, uploadTable, delegationTable, adminMetricsTable, consumerTable, subscriptionTable } = use(UploadDbStack)
  const { invocationBucket, taskBucket, workflowBucket, ucanStream } = use(UcanInvocationStack)

  // Resources for this stack
  const delegationBucket = new Bucket(stack, 'delegation-store', {
    cors: true,
    cdk: {
      bucket: getBucketConfig('delegation', app.stage)
    }
  })

  // Setup API
  const customDomain = getCustomDomain(stack.stage, process.env.HOSTED_ZONE)
  const pkg = getApiPackageJson()
  const git = getGitInfo()
  const privateKey = new Config.Secret(stack, 'PRIVATE_KEY')
  const ucanInvocationPostbasicAuth = new Config.Secret(stack, 'UCAN_INVOCATION_POST_BASIC_AUTH')

  const api = new Api(stack, 'http-gateway', {
    customDomain,
    defaults: {
      function: {
        permissions: [
          storeTable,
          uploadTable,
          delegationTable,
          delegationBucket,
          adminMetricsTable,
          carparkBucket,
          invocationBucket,
          taskBucket,
          workflowBucket,
          ucanStream
        ],
        environment: {
          STORE_TABLE_NAME: storeTable.tableName,
          STORE_BUCKET_NAME: carparkBucket.bucketName,
          UPLOAD_TABLE_NAME: uploadTable.tableName,
          CONSUMER_TABLE_NAME: consumerTable.tableName,
          SUBSCRIPTION_TABLE_NAME: subscriptionTable.tableName,
          DELEGATION_TABLE_NAME: delegationTable.tableName,
          DELEGATION_BUCKET_NAME: delegationBucket.bucketName,
          INVOCATION_BUCKET_NAME: invocationBucket.bucketName,
          TASK_BUCKET_NAME: taskBucket.bucketName,
          WORKFLOW_BUCKET_NAME: workflowBucket.bucketName,
          UCAN_LOG_STREAM_NAME: ucanStream.streamName,
          ADMIN_METRICS_TABLE_NAME: adminMetricsTable.tableName,
          NAME: pkg.name,
          VERSION: pkg.version,
          COMMIT: git.commmit,
          STAGE: stack.stage,
          ACCESS_SERVICE_DID: process.env.ACCESS_SERVICE_DID ?? '',
          ACCESS_SERVICE_URL: process.env.ACCESS_SERVICE_URL ?? '',
          R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID ?? '',
          R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY ?? '',
          R2_REGION: process.env.R2_REGION ?? '',
          R2_DUDEWHERE_BUCKET_NAME: process.env.R2_DUDEWHERE_BUCKET_NAME ?? '',
          R2_ENDPOINT: process.env.R2_ENDPOINT ?? '',
          UPLOAD_API_DID: process.env.UPLOAD_API_DID ?? '',
        },
        bind: [
          privateKey,
          ucanInvocationPostbasicAuth
        ]
      }
    },
    routes: {
      'POST /':       'functions/ucan-invocation-router.handler',
      'POST /ucan':   'functions/ucan.handler',
      'GET /':        'functions/get.home',
      'GET /validate-email': 'functions/validate-email.preValidateEmail',
      'POST /validate-email': 'functions/validate-email.validateEmail',
      'GET /error':   'functions/get.error',
      'GET /version': 'functions/get.version',
      'GET /metrics': 'functions/metrics.handler',
      // AWS API Gateway does not know trailing slash... and Grafana Agent puts trailing slash
      'GET /metrics/{proxy+}': 'functions/metrics.handler',
    },
    accessLog: {
      format:'{"requestTime":"$context.requestTime","requestId":"$context.requestId","httpMethod":"$context.httpMethod","path":"$context.path","routeKey":"$context.routeKey","status":$context.status,"responseLatency":$context.responseLatency,"integrationRequestId":"$context.integration.requestId","integrationStatus":"$context.integration.status","integrationLatency":"$context.integration.latency","integrationServiceStatus":"$context.integration.integrationStatus","ip":"$context.identity.sourceIp","userAgent":"$context.identity.userAgent"}'
    }
  })

  stack.addOutputs({
    ApiEndpoint: api.url,
    CustomDomain:  customDomain ? `https://${customDomain.domainName}` : 'Set HOSTED_ZONE in env to deploy to a custom domain'
  })
}
