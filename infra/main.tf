terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-west-2"
  default_tags {
    tags = { project = "startgg-scraper" }
  }
}

data "aws_caller_identity" "me" {}
data "aws_region" "current" {}

locals {
  name = "startgg-scraper"
  token_param_arn = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.me.account_id}:parameter/startgg-scraper/startgg-token"
}