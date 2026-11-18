# tidewater

![tidewater: watch a folder, sync it to any S3 bucket](docs/banner.png)

`tidewater` watches a folder and keeps it in sync with an S3 bucket. One binary, no daemon, resumable uploads.

```sh
tidewater watch ./site s3://my-bucket/site
```

## When nothing has changed

![An empty harbour at low tide](docs/empty-state.png)

`tidewater status` shows this when the folder and the bucket already match.
