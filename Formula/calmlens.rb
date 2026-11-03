class Calmlens < Formula
  desc "CalmLens CLI for local webhook development"
  homepage "https://calmlens.com"
  version "0.18.3"

  on_macos do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.3/calmlens-0.18.3-darwin-arm64.tar.gz"
      sha256 "a46200818e8545ddcf591b5d7a7cf7ebbbbe99d97ed9b0ac367cebb8ce540750"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.3/calmlens-0.18.3-darwin-x64.tar.gz"
      sha256 "e34608a54b4dae4edd2b566b1e00c2e5501a76adb4c552338d70cce63ef1f213"
    end
  end
  on_linux do
    on_arm do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.3/calmlens-0.18.3-linux-arm64.tar.gz"
      sha256 "e5b15406994990660118a22903608ed4801af9461dc79003b8373226dba635d2"
    end
    on_intel do
      url "https://github.com/CalmLens/sdks/releases/download/cli-v0.18.3/calmlens-0.18.3-linux-x64.tar.gz"
      sha256 "6a348902e77df4894643ddb6d24d10198804608fcb308449dee87325737d31e5"
    end
  end

  def install
    bin.install "calmlens"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/calmlens --version").strip
  end
end
