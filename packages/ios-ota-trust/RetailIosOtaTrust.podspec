Pod::Spec.new do |s|
  s.name = 'RetailIosOtaTrust'
  s.version = '1.0.0'
  s.summary = 'Native trust configuration for Retail iOS OTA'
  s.license = { :type => 'Proprietary' }
  s.homepage = 'https://github.com/amirosesingh/retail-pos'
  s.author = 'Lucky Charm SDN BHD'
  s.source = { :git => 'https://github.com/amirosesingh/retail-pos.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
